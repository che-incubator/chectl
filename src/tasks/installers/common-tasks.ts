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
import * as execa from 'execa'
import { copy, mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CRD, DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER } from '../../constants'
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
    title: `Create the Custom Resource of type ${CHE_CLUSTER_CRD} in the namespace ${flags.chenamespace}`,
    task: async (ctx: any, task: any) => {
      const cheCluster = await kube.getCheCluster(flags.chenamespace)
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

        task.title = `${task.title }... is exported to ${targetFile}`
        ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(targetFile))
      } else {
        task.title = `${task.title }... commonly trusted certificate is used.`
      }

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
