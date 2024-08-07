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

import * as Listr from 'listr'
import { KubeClient } from '../api/kube-client'
import {PodTasks} from './pod-tasks'
import {CheCtlContext, CliContext, EclipseCheContext} from '../context'
import {CHE_NAMESPACE_FLAG, DEBUG_FLAG, DEBUG_PORT_FLAG} from '../flags'
import {EclipseChe} from './installers/eclipse-che/eclipse-che'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'fs-extra'
import {Che} from '../utils/che'
import {newListr, sleep} from '../utils/utls'
import { ux } from '@oclif/core'

export namespace CheTasks {
  export function getWaitCheDeployedTasks(): Listr.ListrTask<any> {
    return {
      title: `Wait for ${EclipseChe.PRODUCT_NAME} ready`,
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        const tasks = newListr([])

        const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
        if (cheCluster) {
          if (!cheCluster.spec?.components?.pluginRegistry?.disableInternalRegistry) {
            tasks.add(PodTasks.getPodStartTasks(EclipseChe.PLUGIN_REGISTRY, EclipseChe.PLUGIN_REGISTRY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
          }

          tasks.add(PodTasks.getPodStartTasks(EclipseChe.DASHBOARD, EclipseChe.DASHBOARD_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(PodTasks.getPodStartTasks(EclipseChe.GATEWAY, EclipseChe.GATEWAY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(PodTasks.getPodStartTasks(EclipseChe.CHE_SERVER, EclipseChe.CHE_SERVER_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(getWaitEclipseCheActiveTask())
        }

        return tasks
      },
    }
  }

  export function getWaitPodsDeletedTasks(): Listr.ListrTask<any> {
    return {
      title: 'Wait all pods deleted',
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()
        const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])

        const tasks = newListr()
        tasks.add(PodTasks.getPodDeletedTask(EclipseChe.GATEWAY, EclipseChe.GATEWAY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(PodTasks.getPodDeletedTask(EclipseChe.DASHBOARD, EclipseChe.DASHBOARD_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(PodTasks.getPodDeletedTask(EclipseChe.CHE_SERVER, EclipseChe.CHE_SERVER_SELECTOR, flags[CHE_NAMESPACE_FLAG]))

        if (!cheCluster?.spec?.components?.pluginRegistry?.disableInternalRegistry) {
          tasks.add(PodTasks.getPodDeletedTask(EclipseChe.PLUGIN_REGISTRY, EclipseChe.PLUGIN_REGISTRY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
        }

        return tasks
      },
    }
  }

  export function getScaleCheDownTasks(): Listr.ListrTask<any> {
    return {
      title: `Scale ${EclipseChe.PRODUCT_NAME} down`,
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()
        const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])

        const tasks = newListr()
        tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.GATEWAY, EclipseChe.GATEWAY_DEPLOYMENT_NAME, 0, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.DASHBOARD, EclipseChe.DASHBOARD_DEPLOYMENT_NAME, 0, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.CHE_SERVER, EclipseChe.CHE_SERVER_DEPLOYMENT_NAME, 0, flags[CHE_NAMESPACE_FLAG]))
        if (!cheCluster?.spec?.components?.pluginRegistry?.disableInternalRegistry) {
          tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.PLUGIN_REGISTRY, EclipseChe.PLUGIN_REGISTRY_DEPLOYMENT_NAME, 0, flags[CHE_NAMESPACE_FLAG]))
        }

        return tasks
      },
    }
  }

  export function getScaleCheUpTasks(): Listr.ListrTask<any> {
    return {
      title: `Scale ${EclipseChe.PRODUCT_NAME} up`,
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()
        const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])

        const tasks = newListr()
        if (cheCluster) {
          if (!cheCluster.spec?.components?.pluginRegistry?.disableInternalRegistry) {
            tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.PLUGIN_REGISTRY, EclipseChe.PLUGIN_REGISTRY_DEPLOYMENT_NAME, 1, flags[CHE_NAMESPACE_FLAG]))
            tasks.add(PodTasks.getPodStartTasks(EclipseChe.PLUGIN_REGISTRY, EclipseChe.PLUGIN_REGISTRY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
          }

          tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.DASHBOARD, EclipseChe.DASHBOARD_DEPLOYMENT_NAME, 1, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(PodTasks.getPodStartTasks(EclipseChe.DASHBOARD, EclipseChe.DASHBOARD_SELECTOR, flags[CHE_NAMESPACE_FLAG]))

          tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.GATEWAY, EclipseChe.GATEWAY_DEPLOYMENT_NAME, 1, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(PodTasks.getPodStartTasks(EclipseChe.GATEWAY, EclipseChe.GATEWAY_SELECTOR, flags[CHE_NAMESPACE_FLAG]))

          tasks.add(PodTasks.getScaleDeploymentTask(EclipseChe.CHE_SERVER, EclipseChe.CHE_SERVER_DEPLOYMENT_NAME, 1, flags[CHE_NAMESPACE_FLAG]))
          tasks.add(PodTasks.getPodStartTasks(EclipseChe.CHE_SERVER, EclipseChe.CHE_SERVER_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
        }

        return tasks
      },
    }
  }

  export function getDebugTasks(): Listr.ListrTask<any> {
    return {
      title: `Debug ${EclipseChe.CHE_SERVER}`,
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        const cheDebugServer = await kubeHelper.getConfigMapValue(EclipseChe.CONFIG_MAP, flags[CHE_NAMESPACE_FLAG], 'CHE_DEBUG_SERVER')
        if (cheDebugServer !== 'true') {
          throw new Error(`Debug is disabled. Use --${DEBUG_FLAG} with server:deploy command to deploy ${EclipseChe.CHE_SERVER} with debug mode enabled.`)
        }

        const chePods = await kubeHelper.listNamespacedPod(flags[CHE_NAMESPACE_FLAG], undefined, EclipseChe.CHE_SERVER_SELECTOR)
        if (chePods.items.length === 0) {
          throw new Error(`${EclipseChe.CHE_SERVER} pod not found`)
        }

        const cheServerPodName = chePods.items[0].metadata!.name!
        await kubeHelper.portForward(cheServerPodName, flags[CHE_NAMESPACE_FLAG], flags[DEBUG_PORT_FLAG])
        task.title = `${task.title}...[Enabled]`
      },
    }
  }

  export function getServerLogsTasks(follow: boolean): Listr.ListrTask<any> {
    return {
      title: `${follow ? 'Start following' : 'Read'} ${EclipseChe.PRODUCT_NAME} installation logs`,
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        await Che.readPodLog(ctx[EclipseCheContext.OPERATOR_NAMESPACE], EclipseChe.CHE_OPERATOR_SELECTOR, ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        await Che.readPodLog(flags[CHE_NAMESPACE_FLAG], EclipseChe.CHE_SERVER_SELECTOR, ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        await Che.readPodLog(flags[CHE_NAMESPACE_FLAG], EclipseChe.PLUGIN_REGISTRY_SELECTOR, ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        await Che.readPodLog(flags[CHE_NAMESPACE_FLAG], EclipseChe.DASHBOARD_SELECTOR, ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        await Che.readPodLog(flags[CHE_NAMESPACE_FLAG], EclipseChe.GATEWAY_SELECTOR, ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        await Che.readNamespaceEvents(flags[CHE_NAMESPACE_FLAG], ctx[CliContext.CLI_COMMAND_LOGS_DIR], follow)
        task.title = `${task.title}...[OK]`
      },
    }
  }

  export function getRetrieveSelfSignedCertificateTask(): Listr.ListrTask {
    return {
      title: `Retrieving ${EclipseChe.PRODUCT_NAME} self-signed CA certificate`,
      // It makes sense to retrieve CA certificate only if self-signed certificate is used.
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()

        const cheCaCert = await Che.readCheCaCert(flags[CHE_NAMESPACE_FLAG])
        if (cheCaCert) {
          const caCertFilePath = path.join(os.tmpdir(), EclipseChe.DEFAULT_CA_CERT_FILE_NAME)
          fs.writeFileSync(caCertFilePath, cheCaCert)
          task.title = `${task.title}...[OK: ${caCertFilePath}]`
        } else {
          task.title = `${task.title}...[commonly trusted certificate is used]`
        }
      },
    }
  }

  export function getWaitEclipseCheActiveTask(): Listr.ListrTask<any> {
    return {
      title: `Wait ${EclipseChe.PRODUCT_NAME} active`,
      task: async (_ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        for (let i = 0; i < 300; i++) {
          const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
          if (cheCluster?.status?.chePhase !== 'Active' || !cheCluster?.status?.cheVersion) {
            await sleep(1000)
          } else {
            task.title = `${task.title}...[OK]`
            return
          }
        }

        ux.error(`${EclipseChe.PRODUCT_NAME} is not Active.`, {exit: 1})
      },
    }
  }
}
