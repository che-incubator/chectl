/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import ansi = require('ansi-colors')
import { cli } from 'cli-ux'
import * as execa from 'execa'
import { copy, mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CR_NAME, DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER } from '../../constants'
import { isKubernetesPlatformFamily, isOpenshiftPlatformFamily } from '../../util'

export function createNamespaceTask(flags: any): Listr.ListrTask {
  return {
    title: `Create Namespace (${flags.chenamespace})`,
    task: async (_ctx: any, task: any) => {
      const che = new CheHelper(flags)
      const exist = await che.cheNamespaceExist(flags.chenamespace)
      if (exist) {
        task.title = `${task.title}...It already exists.`
      } else if (isKubernetesPlatformFamily(flags.platform)) {
        await execa(`kubectl create namespace ${flags.chenamespace}`, { shell: true })
        task.title = `${task.title}...done.`
      } else if (isOpenshiftPlatformFamily(flags.platform)) {
        await execa(`oc new-project ${flags.chenamespace}`, { shell: true })
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
    title: `Create Eclipse Che cluster ${CHE_CLUSTER_CR_NAME} in namespace ${flags.chenamespace}`,
    task: async (ctx: any, task: any) => {
      const cheCluster = await kube.getCheCluster(CHE_CLUSTER_CR_NAME, flags.chenamespace)
      if (cheCluster) {
        task.title = `${task.title}...It already exists.`
      } else {
        // Eclipse Che operator supports only Multi-User Che
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

        if (cr.spec.auth && cr.spec.auth.updateAdminPassword) {
          ctx.highlightedMessages.push('Eclipse Che admin credentials are: "admin:admin". You will be asked to change default Che admin password on the first login.')
        }

        task.title = `${task.title}...done.`
      }
    }
  }
}

export function checkTlsCertificate(flags: any): Listr.ListrTask {
  return {
    title: 'Checking certificate',
    // It makes sense to check whether self-signed certificate is used only if TLS mode is on
    enabled: () => flags.tls,
    // If the flag is set no need to check if it is required
    skip: () => flags['self-signed-cert'],
    task: async (_: any, task: any) => {
      const warningMessage = 'Self-signed certificate is used, so "--self-signed-cert" option is required. Added automatically.'

      const platform = flags.platform
      if (platform === 'minikube' || platform === 'crc' || platform === 'minishift') {
        // There is no way to use real certificate on listed above platforms
        cli.warn(warningMessage)
        flags['self-signed-cert'] = true
        task.title = `${task.title}... self-signed`
        return
      }

      if (flags.domain && (flags.domain.endsWith('nip.io') || flags.domain.endsWith('xip.io'))) {
        // It is not possible to use real certificate with *.nip.io and similar services
        cli.warn(warningMessage)
        flags['self-signed-cert'] = true
        task.title = `${task.title}... self-signed`
        return
      }

      // TODO check the secret certificate if it is commonly trusted.
      cli.info('TLS mode is turned on, however we failed to determine whether self-signed certificate is used. \n\
               Please rerun chectl with "--self-signed-cert" option if it is the case, otherwise Eclipse Che will fail to start.')
    }
  }
}

export function retrieveCheCaCertificateTask(flags: any): Listr.ListrTask {
  return {
    title: 'Retrieving Che self-signed CA certificate',
    // It makes sense to retrieve CA certificate only if self-signed certificate is used.
    enabled: () => flags.tls && flags['self-signed-cert'] && flags.installer !== 'helm',
    task: async (ctx: any, task: any) => {
      const che = new CheHelper(flags)
      const cheCaCert = await che.retrieveCheCaCert(flags.chenamespace)
      const targetFile = await che.saveCheCaCert(cheCaCert)

      task.title = `${task.title }... is exported to ${targetFile}`
      ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(targetFile))
    }
  }
}

export function getMessageImportCaCertIntoBrowser(caCertFileLocation: string): string {
  const message = `❗${ansi.yellow('[MANUAL ACTION REQUIRED]')} Please add Che self-signed CA certificate into your browser: ${caCertFileLocation}.\n` +
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
        ctx.highlightedMessages.push(`Autogenerated Keycloak credentials are: "${login}:${password}".`)

        task.title = `${task.title }... ${login}:${password}`
      } else {
        task.title = `${task.title }... Failed.`
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
