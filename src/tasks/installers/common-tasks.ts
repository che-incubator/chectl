/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command'
import ansi = require('ansi-colors')
import { cli } from 'cli-ux'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import { isEmpty } from 'lodash'
import * as path from 'path'
import { exit } from 'process'
import * as rimraf from 'rimraf'

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { CheGithubClient } from '../../api/github-client'
import { KubeHelper } from '../../api/kube'
import { ChectlBreakingVersionDetails, ChectlBreakingVersions, VersionHelper } from '../../api/version'
import { CHE_CLUSTER_CRD, DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER } from '../../constants'
import { downloadYaml, getCurrentChectlName, getCurrentChectlVersion } from '../../util'

export function createNamespaceTask(namespaceName: string, labels: {}): Listr.ListrTask {
  return {
    title: `Create Namespace (${namespaceName})`,
    task: async (_ctx: any, task: any) => {
      const kube = new KubeHelper()
      const che = new CheHelper({})

      const namespace = await kube.getNamespace(namespaceName)
      if (namespace) {
        await che.waitNamespaceActive(namespaceName)
        task.title = `${task.title}...It already exists.`
      } else {
        await kube.createNamespace(namespaceName, labels)
        await che.waitNamespaceActive(namespaceName)
        task.title = `${task.title}...Done.`
      }
    }
  }
}

/**
 * Sets flags.templates based on required version and installer.
 * Does not support OLM.
 */
export function prepareTemplates(flags: any): Listr.ListrTask {
  return {
    title: 'Prepare templates',
    enabled: () => !flags.templates && flags.installer !== 'olm',
    task: async (ctx: any, task: any) => {
      // All templates are stored in the cache directory
      // Example path: ~/.cache/chectl/templates/7.15.1/
      const templatesRootDir = path.join(ctx[ChectlContext.CACHE_DIR], 'templates')

      let installerTemplatesSubDir: string
      switch (flags.installer) {
      case 'operator':
        installerTemplatesSubDir = 'che-operator'
        break
      case 'helm':
        installerTemplatesSubDir = 'kubernetes'
        break
      case 'olm':
        // Should be handled on install phase when catalog source is deployed
        return
      default:
        throw new Error(`Unknow installer ${flags.installer}`)
      }

      const githubClient = new CheGithubClient()
      const cheHelper = new CheHelper(flags)

      // 'nightly' is an alias for 'next'. As we use version as part of templates path it should be converted.
      if (flags.version === 'nightly') {
        flags.version = 'next'
      }
      const isNextVersion = flags.version === 'next'
      const verInfo = await githubClient.getTemplatesTagInfo(flags.installer, flags.version)
      if (!verInfo) {
        throw new Error(`Version ${flags.version} does not exist`)
      }
      flags.version = VersionHelper.removeVPrefix(verInfo.name, true)

      const versionTemplatesDirPath = path.join(templatesRootDir, flags.version)
      flags.templates = versionTemplatesDirPath

      const installerTemplatesDirPath = path.join(versionTemplatesDirPath, installerTemplatesSubDir)
      const commitHashFilePath = path.join(installerTemplatesDirPath, 'commit-hash.txt')
      if (fs.existsSync(installerTemplatesDirPath)) {
        if (isNextVersion) {
          // Check commit hash
          try {
            const commitHash = (await fs.readFile(commitHashFilePath)).toString()
            if (commitHash === verInfo.commit.sha) {
              task.title = `${task.title}... found up to date cached version: ${flags.version}`
              return
            }
          } catch {
            // Failed to compare commits hashes.
            // Suppose they are different
          }
          // Delete old templates and download newer
          rimraf.sync(versionTemplatesDirPath)
        } else {
          // Use cached templates
          task.title = `${task.title}... found cache for version ${flags.version}`
          return
        }
      }

      // Download templates
      task.title = `${task.title} for version ${flags.version}`
      await cheHelper.getAndPrepareInstallerTemplates(flags.installer, verInfo.zipball_url, versionTemplatesDirPath)
      ctx.downloadedNewTemplates = true
      // Save commit hash
      await fs.writeFile(commitHashFilePath, verInfo.commit.sha)
    }
  }
}

export function getCheckChectlAndCheCompatibilityTask(flags: any): Listr.ListrTask {
  return {
    title: 'Check chectl version compatibility',
    enabled: () => getCurrentChectlName() === 'chectl' && !flags['skip-version-check'],
    task: async (_ctx: any, task: any) => {
      const desiredCheVersion: string = flags.version

      const chectlVersion = getCurrentChectlVersion()
      if (chectlVersion === '0.0.2') {
        // Development version, skip checks
        return
      }
      const chectlChannel: keyof ChectlBreakingVersionDetails = chectlVersion.includes('next') ? 'nightly' : 'stable'

      const versionsCompatibility: ChectlBreakingVersions = (await downloadYaml('https://raw.githubusercontent.com/che-incubator/chectl/master/versions-compatibility.yaml')).v1
      const installer: keyof ChectlBreakingVersions = flags.installer
      const installerBreakingVersions = versionsCompatibility[installer]

      for (const breakingVerData of installerBreakingVersions) {
        if (VersionHelper.compareVersions(desiredCheVersion, breakingVerData.cheVersion) >= 0) {
          const minimalRequiredChectlVersion = breakingVerData.minimalChectlVeriosn[chectlChannel]
          if (VersionHelper.compareVersions(chectlVersion, minimalRequiredChectlVersion) < 0) {
            task.title = `${task.title}... FAIL`
            cli.info(`To install Eclipse Che version ${desiredCheVersion} it is required to have chectl ${minimalRequiredChectlVersion} or newer.`)
            cli.info('Please update chectl with the following command: "chectl update"')
            exit(0)
          }
        }
      }

      task.title = `${task.title}... OK`
    }
  }
}

export function createEclipseCheCluster(flags: any, kube: KubeHelper): Listr.ListrTask {
  return {
    title: `Create the Custom Resource of type ${CHE_CLUSTER_CRD} in the namespace ${flags.chenamespace}`,
    enabled: ctx => !!ctx.customCR || !!ctx.defaultCR,
    task: async (ctx: any, task: any) => {
      ctx.isCheDeployed = true
      ctx.isPostgresDeployed = true
      ctx.isKeycloakDeployed = true

      // plugin and devfile registry will be deployed only when external ones are not configured
      ctx.isPluginRegistryDeployed = !(flags['plugin-registry-url'] as boolean)
      ctx.isDevfileRegistryDeployed = !(flags['devfile-registry-url'] as boolean)

      const cheClusterCR = ctx.customCR || ctx.defaultCR
      const cr = await kube.createCheCluster(cheClusterCR, flags, ctx, !ctx.customCR)

      ctx.isKeycloakReady = ctx.isKeycloakReady || cr.spec.auth.externalIdentityProvider
      ctx.isPostgresReady = ctx.isPostgresReady || cr.spec.database.externalDb
      ctx.isDevfileRegistryReady = ctx.isDevfileRegistryReady || cr.spec.server.externalDevfileRegistry
      ctx.isPluginRegistryReady = ctx.isPluginRegistryReady || cr.spec.server.externalPluginRegistry

      if (cr.spec.server.customCheProperties && cr.spec.server.customCheProperties.CHE_MULTIUSER === 'false') {
        flags.multiuser = false
      }

      task.title = `${task.title}...done.`
    }
  }
}

/**
 * Update CheCluster CR object using CR patch file.
 * Clean up custom images if they weren't defined in the CR patch file to prevent update failing.
 * @param flags - parent command flags
 * @param kube - kubeHelper util
 * @param command - parent command
 */
export function patchingEclipseCheCluster(flags: any, kube: KubeHelper, command: Command): Listr.ListrTask {
  return {
    title: `Patching the Custom Resource of type '${CHE_CLUSTER_CRD}' in the namespace '${flags.chenamespace}'`,
    skip: (ctx: any) => isEmpty(ctx[ChectlContext.CR_PATCH]),
    task: async (ctx: any, task: any) => {
      const cheCluster = await kube.getCheCluster(flags.chenamespace)
      if (!cheCluster) {
        command.error(`Eclipse Che cluster CR is not found in the namespace '${flags.chenamespace}'`)
      }
      await kube.patchCheCluster(cheCluster.metadata.name, flags.chenamespace, ctx[ChectlContext.CR_PATCH])
      task.title = `${task.title}...done.`
    }
  }
}

export function retrieveCheCaCertificateTask(flags: any): Listr.ListrTask {
  return {
    title: 'Retrieving Che self-signed CA certificate',
    // It makes sense to retrieve CA certificate only if self-signed certificate is used.
    enabled: () => flags.tls && flags.installer !== 'helm',
    task: async (ctx: any, task: any) => {
      const che = new CheHelper(flags)
      const kube = new KubeHelper()
      const cheCaCert = await che.retrieveCheCaCert(flags.chenamespace)
      if (cheCaCert) {
        const targetFile = await che.saveCheCaCert(cheCaCert)

        task.title = `${task.title}... done`
        const serverStrategy = await kube.getConfigMapValue('che', flags.chenamespace, 'CHE_INFRA_KUBERNETES_SERVER__STRATEGY')
        if (serverStrategy !== 'single-host') {
          ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(targetFile))
        }
      } else {
        task.title = `${task.title}... commonly trusted certificate is used.`
      }

    }
  }
}

export function getMessageImportCaCertIntoBrowser(caCertFileLocation: string): string {
  const message = `${ansi.yellow('[ACTION REQUIRED]')} Please add Che self-signed CA certificate into your browser: ${caCertFileLocation}.\n` +
    `Documentation how to add a CA certificate into a browser: ${DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER}`
  return message
}

export function getRetrieveKeycloakCredentialsTask(flags: any): Listr.ListrTask {
  return {
    title: 'Retrieving Keycloak admin credentials',
    enabled: () => (flags.installer !== 'helm'),
    task: async (ctx: any, task: any) => {
      const che = new CheHelper(flags)
      const [login, password] = await che.retrieveKeycloakAdminCredentials(flags.chenamespace)
      if (login && password) {
        ctx.identityProviderUsername = login
        ctx.identityProviderPassword = password
        task.title = `${task.title}...done`
      } else {
        task.title = `${task.title}...failed.`
      }
    }
  }
}

/**
 * Prints important to user messages which are stored in ctx.highlightedMessages
 * Typically this task is the last task of a command.
 */
export function getPrintHighlightedMessagesTask(): Listr.ListrTask {
  return {
    title: 'Show important messages',
    enabled: ctx => ctx.highlightedMessages && ctx.highlightedMessages.length > 0,
    task: (ctx: any) => {
      const printMessageTasks = new Listr([], ctx.listrOptions)
      for (const message of ctx.highlightedMessages) {
        printMessageTasks.add({
          title: message,
          task: () => { }
        })
      }
      return printMessageTasks
    }
  }
}
