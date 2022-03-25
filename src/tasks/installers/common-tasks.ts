/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import ansi = require('ansi-colors')
import * as fs from 'fs-extra'
import * as os from 'os'
import * as Listr from 'listr'
import { isEmpty } from 'lodash'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CRD, DEFAULT_CA_CERT_FILE_NAME, DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER } from '../../constants'
import { isCheClusterAPIV1 } from '../../util'
import { cli } from 'cli-ux'

export const TASK_TITLE_PATCH_CHECLUSTER_CR = `Patching the Custom Resource of type ${CHE_CLUSTER_CRD}`

export function createNamespaceTask(namespaceName: string, labels: {}): Listr.ListrTask {
  return {
    title: `Create Namespace ${namespaceName}`,
    task: async (_ctx: any, task: any) => {
      const kube = new KubeHelper()

      const namespace = await kube.getNamespace(namespaceName)
      if (namespace) {
        await kube.waitNamespaceActive(namespaceName)
        task.title = `${task.title}...[Exists]`
      } else {
        const namespace = {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            labels,
            name: namespaceName,
          },
        }

        await kube.createNamespace(namespace)
        await kube.waitNamespaceActive(namespaceName)
        task.title = `${task.title}...[OK]`
      }
    },
  }
}

export function createEclipseCheClusterTask(flags: any, kube: KubeHelper): Listr.ListrTask {
  return {
    title: `Create the Custom Resource of type ${CHE_CLUSTER_CRD}`,
    task: async (ctx: any, task: any) => {
      task.title = `${task.title} in the namespace ${flags.chenamespace}`

      const cheCluster = await kube.getCheClusterV1(flags.chenamespace)
      if (cheCluster) {
        task.title = `${task.title}...[Skipped: Exists]`
        return
      }

      ctx.isCheDeployed = true
      ctx.isPostgresDeployed = true
      ctx.isDashboardDeployed = true

      // plugin and devfile registry will be deployed only when external ones are not configured
      ctx.isPluginRegistryDeployed = !(flags['plugin-registry-url'] as boolean)
      ctx.isDevfileRegistryDeployed = !(flags['devfile-registry-url'] as boolean)

      const cheClusterCR = ctx[ChectlContext.CUSTOM_CR] || ctx[ChectlContext.DEFAULT_CR]
      const checluster = await kube.createCheCluster(cheClusterCR, flags, ctx, !ctx[ChectlContext.CUSTOM_CR])

      ctx.isPostgresReady = ctx.isPostgresReady || checluster.spec.database.externalDb
      const isCheClusterApiV1 = isCheClusterAPIV1(cheClusterCR)
      if (isCheClusterApiV1) {
        ctx.isDevfileRegistryReady = ctx.isDevfileRegistryReady || checluster.spec.server.externalDevfileRegistry
        ctx.isPluginRegistryReady = ctx.isPluginRegistryReady || checluster.spec.server.externalPluginRegistry
      } else {
        ctx.isDevfileRegistryReady = ctx.isDevfileRegistryReady || checluster.spec.pluginregistry?.disableInternalRegistry
        ctx.isPluginRegistryReady = ctx.isPluginRegistryReady || checluster.spec.devfileRegistry?.disableInternalRegistry
      }

      task.title = `${task.title}...[Created].`
    },
  }
}

/**
 * Update CheCluster CR object using CR patch file.
 * Clean up custom images if they weren't defined in the CR patch file to prevent update failing.
 * @param flags - parent command flags
 * @param kube - kubeHelper util
 * @param command - parent command
 */
export function patchingEclipseCheCluster(flags: any, kube: KubeHelper): Listr.ListrTask {
  return {
    title: TASK_TITLE_PATCH_CHECLUSTER_CR,
    skip: (ctx: any) => isEmpty(ctx[ChectlContext.CR_PATCH]),
    task: async (ctx: any, task: any) => {
      task.title = `${task.title} in the namespace ${flags.chenamespace}`
      const cheCluster = await kube.getCheClusterV1(flags.chenamespace)
      if (!cheCluster) {
        cli.error(`Eclipse Che cluster CR is not found in the namespace '${flags.chenamespace}'`)
      }
      await kube.patchCheCluster(cheCluster.metadata.name, flags.chenamespace, ctx[ChectlContext.CR_PATCH])
      task.title = `${task.title}...done.`
    },
  }
}

export function retrieveCheCaCertificateTask(flags: any): Listr.ListrTask {
  return {
    title: 'Retrieving Che self-signed CA certificate',
    // It makes sense to retrieve CA certificate only if self-signed certificate is used.
    task: async (ctx: any, task: any) => {
      const che = new CheHelper(flags)
      const kube = new KubeHelper()
      const cheCaCert = await che.retrieveCheCaCert(flags.chenamespace)
      if (cheCaCert) {
        const caCertFilePath = path.join(os.tmpdir(), DEFAULT_CA_CERT_FILE_NAME)
        fs.writeFileSync(caCertFilePath, cheCaCert)
        task.title = `${task.title}...OK`
        const serverStrategy = await kube.getConfigMapValue('che', flags.chenamespace, 'CHE_INFRA_KUBERNETES_SERVER__STRATEGY')
        if (serverStrategy !== 'single-host') {
          ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(caCertFilePath))
        }
      } else {
        task.title = `${task.title}... commonly trusted certificate is used.`
      }
    },
  }
}

export function getMessageImportCaCertIntoBrowser(caCertFileLocation: string): string {
  const message = `${ansi.yellow('[ACTION REQUIRED]')} Please add Che self-signed CA certificate into your browser: ${caCertFileLocation}.\n` +
    `Documentation how to add a CA certificate into a browser: ${DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER}`
  return message
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
          task: () => { },
        })
      }
      return printMessageTasks
    },
  }
}
