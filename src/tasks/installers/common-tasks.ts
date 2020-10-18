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
import * as execa from 'execa'
import { copy, existsSync, mkdirp, readFileSync, remove } from 'fs-extra'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import { merge } from 'lodash'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CHE_OPERATOR_CR_PATCH_YAML_KEY } from '../../common-flags'
import { CHE_CLUSTER_CRD, DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER } from '../../constants'
import { isKubernetesPlatformFamily, isOpenshiftPlatformFamily } from '../../util'

export function createNamespaceTask(namespace: string, platform: string): Listr.ListrTask {
  return {
    title: `Create Namespace (${namespace})`,
    task: async (_ctx: any, task: any) => {
      const kube = new KubeHelper()
      const exist = await kube.namespaceExist(namespace)
      if (exist) {
        task.title = `${task.title}...It already exists.`
      } else if (isKubernetesPlatformFamily(platform)) {
        await execa(`kubectl create namespace ${namespace}`, { shell: true })
        task.title = `${task.title}...done.`
      } else if (isOpenshiftPlatformFamily(platform)) {
        await execa(`oc new-project ${namespace}`, { shell: true })
        task.title = `${task.title}...done.`
      }
    }
  }
}

export function copyOperatorResources(flags: any, cacheDir: string): Listr.ListrTask {
  return {
    title: 'Copying operator resources',
    task: async (ctx: any, task: any) => {
      ctx.resourcesPath = await copyCheOperatorResources(flags.templates, cacheDir)
      task.title = `${task.title}...done.`
    }
  }
}

async function copyCheOperatorResources(templatesDir: string, cacheDir: string): Promise<string> {
  const srcDir = path.join(templatesDir, '/che-operator/')
  const destDir = path.join(cacheDir, '/templates/che-operator/')

  await remove(destDir)
  await mkdirp(destDir)
  await copy(srcDir, destDir)

  return destDir
}

export function createEclipseCheCluster(flags: any, kube: KubeHelper): Listr.ListrTask {
  return {
    title: `Create the Custom Resource of type ${CHE_CLUSTER_CRD} in the namespace ${flags.chenamespace}`,
    task: async (ctx: any, task: any) => {
      const cheCluster = await kube.getCheCluster(flags.chenamespace)
      if (cheCluster) {
        task.title = `${task.title}...It already exists.`
      } else {
        ctx.isCheDeployed = true
        ctx.isPostgresDeployed = true
        ctx.isKeycloakDeployed = true

        // plugin and devfile registry will be deployed only when external ones are not configured
        ctx.isPluginRegistryDeployed = !(flags['plugin-registry-url'] as boolean)
        ctx.isDevfileRegistryDeployed = !(flags['devfile-registry-url'] as boolean)

        const yamlFilePath = flags['che-operator-cr-yaml'] === '' ? ctx.resourcesPath + 'crds/org_v1_che_cr.yaml' : flags['che-operator-cr-yaml']
        const cr = await kube.createCheClusterFromFile(yamlFilePath, flags, ctx, flags['che-operator-cr-yaml'] === '')
        ctx.cr = cr
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
}

export function updateEclipseCheCluster(flags: any, kube: KubeHelper, command: Command): Listr.ListrTask {
  return {
    title: `Update the Custom Resource of type ${CHE_CLUSTER_CRD} in the namespace ${flags.chenamespace}`,
    enabled: () => !!flags[CHE_OPERATOR_CR_PATCH_YAML_KEY],
    task: async (ctx: any, task: any) => {
      const cheOperatorCrPatchYamlPath = flags[CHE_OPERATOR_CR_PATCH_YAML_KEY]
      if (existsSync(cheOperatorCrPatchYamlPath)) {
        const crPatch: any = yaml.safeLoad(readFileSync(cheOperatorCrPatchYamlPath).toString())
        const cheCluster = await kube.getCheCluster(flags.chenamespace)
        if (!cheCluster) {
          command.error(`Eclipse Che cluster CR was not found in the namespace ${flags.chenamespace}`)
        }

        if (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.pluginRegistryImage) {
          merge(crPatch, {spec: {server: { pluginRegistryImage: '' } } })
        }
        if (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.devfileRegistryImage) {
          merge(crPatch, {spec: {server: { devfileRegistryImage: '' } } })
        }
        if (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.identityProviderImage) {
          merge(crPatch, {spec: {server: { identityProviderImage: '' } } })
        }
        if (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.cheImage) {
          merge(crPatch, {spec: {server: { cheImage: '' } } })
        }
        if (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.cheImageTag) {
          merge(crPatch, {spec: {server: { cheImageTag: '' } } })
        }

        await kube.patchCheCluster(cheCluster.metadata.name, flags.chenamespace, crPatch)
        task.title = `${task.title}...done.`
      } else {
        command.error(`Unable to find patch file defined in the flag '--${CHE_OPERATOR_CR_PATCH_YAML_KEY}'`)
      }
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
      const cheCaCert = await che.retrieveCheCaCert(flags.chenamespace)
      if (cheCaCert) {
        const targetFile = await che.saveCheCaCert(cheCaCert)

        task.title = `${task.title}... done`
        ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(targetFile))
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
    enabled: (ctx: any) => ctx.cr && !ctx.cr.spec.auth.externalIdentityProvider && flags.multiuser && (flags.installer !== 'operator' || flags.installer !== 'olm'),
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
