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

import { Command } from '@oclif/command'
import * as Listr from 'listr'
import { CheHelper } from '../api/che'
import { CheApiClient } from '../api/che-api-client'
import { KubeHelper } from '../api/kube'
import { OpenShiftHelper } from '../api/openshift'
import { VersionHelper } from '../api/version'
import { CHE_OPERATOR_SELECTOR, DOC_LINK, DOC_LINK_RELEASE_NOTES, OUTPUT_SEPARATOR } from '../constants'
import { addTrailingSlash, base64Decode, newError } from '../util'
import { KubeTasks } from './kube'

/**
 * Holds tasks to work with Eclipse Che component.
 */
export class CheTasks {
  kube: KubeHelper
  kubeTasks: KubeTasks
  oc = new OpenShiftHelper()
  che: CheHelper
  cheNamespace: string
  cheSelector = 'app=che,component=che'
  cheDeploymentName = 'che'
  dashboardDeploymentName = 'che-dashboard'
  dashboardSelector = 'app=che,component=che-dashboard'
  postgresDeploymentName = 'postgres'
  postgresSelector = 'app=che,component=postgres'
  devfileRegistryDeploymentName = 'devfile-registry'
  devfileRegistrySelector = 'app=che,component=devfile-registry'
  pluginRegistryDeploymentName = 'plugin-registry'
  pluginRegistrySelector = 'app=che,component=plugin-registry'
  cheConsoleLinkName = 'che'

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
    this.kubeTasks = new KubeTasks(flags)
    this.che = new CheHelper(flags)
    this.cheNamespace = flags.chenamespace
  }

  /**
   * Returns tasks list that waits until every Eclipse Che component will be started.
   *
   * Note that Eclipse Che components statuses should be already set in context.
   *
   * @see che.checkIfCheIsInstalledTasks
   */
  waitDeployedChe(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'PostgreSQL pod bootstrap',
        enabled: ctx => ctx.isPostgresDeployed && !ctx.isPostgresReady,
        task: () => this.kubeTasks.podStartTasks(this.postgresSelector, this.cheNamespace),
      },
      {
        title: 'Devfile Registry pod bootstrap',
        enabled: ctx => ctx.isDevfileRegistryDeployed && !ctx.isDevfileRegistryReady,
        task: () => this.kubeTasks.podStartTasks(this.devfileRegistrySelector, this.cheNamespace),
      },
      {
        title: 'Plug-in Registry pod bootstrap',
        enabled: ctx => ctx.isPluginRegistryDeployed && !ctx.isPluginRegistryReady,
        task: () => this.kubeTasks.podStartTasks(this.pluginRegistrySelector, this.cheNamespace),
      },
      {
        title: 'Eclipse Che Dashboard pod bootstrap',
        enabled: ctx => ctx.isDashboardDeployed && !ctx.isDashboardReady,
        task: () => this.kubeTasks.podStartTasks(this.dashboardSelector, this.cheNamespace),
      },
      {
        title: 'Eclipse Che Server pod bootstrap',
        enabled: ctx => !ctx.isCheReady,
        task: () => this.kubeTasks.podStartTasks(this.cheSelector, this.cheNamespace),
      },
      ...this.checkEclipseCheStatus(),
    ]
  }

  /**
   * Returns list of tasks that checks if Eclipse Che is already installed.
   *
   * After executing the following properties are set in context:
   * is[Component]Deployed, is[Component]Stopped, is[Component]Ready
   * where component is one the: Che, Postgres, PluginRegistry, DevfileRegistry
   */
  checkIfCheIsInstalledTasks(_flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Verify if Eclipse Che is deployed into namespace \"${this.cheNamespace}\"`,
        task: async (ctx: any, task: any) => {
          if (await this.kube.isDeploymentExist(this.cheDeploymentName, this.cheNamespace)) {
            ctx.isCheDeployed = true
            ctx.isCheReady = await this.kube.isDeploymentReady(this.cheDeploymentName, this.cheNamespace)
            if (!ctx.isCheReady) {
              ctx.isCheStopped = await this.kube.isDeploymentStopped(this.cheDeploymentName, this.cheNamespace)
            }

            ctx.isDashboardDeployed = await this.kube.isDeploymentExist(this.dashboardDeploymentName, this.cheNamespace)
            if (ctx.isDashboardDeployed) {
              ctx.isDashboardReady = await this.kube.isDeploymentReady(this.dashboardDeploymentName, this.cheNamespace)
              if (!ctx.isDashboardReady) {
                ctx.isDashboardStopped = await this.kube.isDeploymentStopped(this.dashboardDeploymentName, this.cheNamespace)
              }
            }

            ctx.isPostgresDeployed = await this.kube.isDeploymentExist(this.postgresDeploymentName, this.cheNamespace)
            if (ctx.isPostgresDeployed) {
              ctx.isPostgresReady = await this.kube.isDeploymentReady(this.postgresDeploymentName, this.cheNamespace)
              if (!ctx.isPostgresReady) {
                ctx.isPostgresStopped = await this.kube.isDeploymentStopped(this.postgresDeploymentName, this.cheNamespace)
              }
            }

            ctx.isDevfileRegistryDeployed = await this.kube.isDeploymentExist(this.devfileRegistryDeploymentName, this.cheNamespace)
            if (ctx.isDevfileRegistryDeployed) {
              ctx.isDevfileRegistryReady = await this.kube.isDeploymentReady(this.devfileRegistryDeploymentName, this.cheNamespace)
              if (!ctx.isDevfileRegistryReady) {
                ctx.isDevfileRegistryStopped = await this.kube.isDeploymentStopped(this.devfileRegistryDeploymentName, this.cheNamespace)
              }
            }

            ctx.isPluginRegistryDeployed = await this.kube.isDeploymentExist(this.pluginRegistryDeploymentName, this.cheNamespace)
            if (ctx.isPluginRegistryDeployed) {
              ctx.isPluginRegistryReady = await this.kube.isDeploymentReady(this.pluginRegistryDeploymentName, this.cheNamespace)
              if (!ctx.isPluginRegistryReady) {
                ctx.isPluginRegistryStopped = await this.kube.isDeploymentStopped(this.pluginRegistryDeploymentName, this.cheNamespace)
              }
            }
          }

          if (!ctx.isCheDeployed) {
            task.title = `${task.title}...it is not`
          } else {
            return new Listr([
              {
                enabled: () => ctx.isCheDeployed,
                title: `Found ${ctx.isCheStopped ? 'stopped' : 'running'} Eclipse Che deployment`,
                task: () => { },
              },
              {
                enabled: () => ctx.isPostgresDeployed,
                title: `Found ${ctx.isPostgresStopped ? 'stopped' : 'running'} postgres deployment`,
                task: () => { },
              },
              {
                enabled: () => ctx.isPluginRegistryDeployed,
                title: `Found ${ctx.isPluginRegistryStopped ? 'stopped' : 'running'} plugin registry deployment`,
                task: () => { },
              },
              {
                enabled: () => ctx.isDevfileRegistryDeployed,
                title: `Found ${ctx.isDevfileRegistryStopped ? 'stopped' : 'running'} devfile registry deployment`,
                task: () => { },
              },
            ])
          }
        },
      },
      {
        title: 'Check Eclipse Che server status',
        enabled: (ctx: any) => ctx.isCheDeployed && ctx.isCheReady,
        task: async (_ctx: any, task: any) => {
          let cheURL = ''
          try {
            cheURL = await this.che.cheURL(this.cheNamespace)
            const cheApi = CheApiClient.getInstance(cheURL + '/api')
            const status = await cheApi.getCheServerStatus()
            task.title = `${task.title}...${status}`
          } catch (error) {
            return newError(`Failed to check Eclipse Che status (URL: ${cheURL}).`, error)
          }
        },
      },
    ]
  }

  /**
   * Returns tasks list which scale up all Eclipse Che components which are deployed.
   * It requires {@link this#checkIfCheIsInstalledTasks} to be executed before.
   *
   * @see [CheTasks](#checkIfCheIsInstalledTasks)
   */
  scaleCheUpTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'PostgreSQL pod bootstrap',
        enabled: ctx => ctx.isPostgresDeployed && !ctx.isPostgresReady,
        task: async () => {
          await this.kube.scaleDeployment(this.postgresDeploymentName, this.cheNamespace, 1)
          return this.kubeTasks.podStartTasks(this.postgresSelector, this.cheNamespace)
        },
      },
      {
        title: 'Devfile registry pod bootstrap',
        enabled: ctx => ctx.isDevfileRegistryDeployed && !ctx.isDevfileRegistryReady,
        task: async () => {
          await this.kube.scaleDeployment(this.devfileRegistryDeploymentName, this.cheNamespace, 1)
          return this.kubeTasks.podStartTasks(this.devfileRegistrySelector, this.cheNamespace)
        },
      },
      {
        title: 'Plug-in Registry pod bootstrap',
        enabled: ctx => ctx.isPluginRegistryDeployed && !ctx.isPluginRegistryReady,
        task: async () => {
          await this.kube.scaleDeployment(this.pluginRegistryDeploymentName, this.cheNamespace, 1)
          return this.kubeTasks.podStartTasks(this.pluginRegistrySelector, this.cheNamespace)
        },
      },
      {
        title: 'Eclipse Che Dashboard pod bootstrap',
        enabled: ctx => ctx.isDashboardDeployed && !ctx.isDashboardReady,
        task: async () => {
          await this.kube.scaleDeployment(this.dashboardDeploymentName, this.cheNamespace, 1)
          return this.kubeTasks.podStartTasks(this.dashboardSelector, this.cheNamespace)
        },
      },
      {
        title: 'Eclipse Che Server pod bootstrap',
        enabled: ctx => ctx.isCheDeployed && !ctx.isCheReady,
        task: async () => {
          await this.kube.scaleDeployment(this.cheDeploymentName, this.cheNamespace, 1)
          return this.kubeTasks.podStartTasks(this.cheSelector, this.cheNamespace)
        },
      },
      ...this.checkEclipseCheStatus(),
    ]
  }

  /**
   * Returns tasks list which scale down all Eclipse Che components which are deployed.
   * It requires {@link this#checkIfCheIsInstalledTasks} to be executed before.
   *
   * @see [CheTasks](#checkIfCheIsInstalledTasks)
   */
  scaleCheDownTasks(): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: `Scale \"${this.cheDeploymentName}\" deployment to zero`,
      enabled: (ctx: any) => !ctx.isCheStopped,
      task: async (_ctx: any, task: any) => {
        try {
          await this.kube.scaleDeployment(this.cheDeploymentName, this.cheNamespace, 0)
          task.title = `${task.title}...done`
        } catch (error) {
          return newError(`Failed to scale ${this.cheDeploymentName} deployment.`, error)
        }
      },
    },
    {
      title: 'Scale \"dashboard\" deployment to zero',
      enabled: (ctx: any) => ctx.isDashboardDeployed && !ctx.isDashboardStopped,
      task: async (_ctx: any, task: any) => {
        try {
          await this.kube.scaleDeployment(this.dashboardDeploymentName, this.cheNamespace, 0)
          task.title = `${task.title}...done`
        } catch (error) {
          return newError('Failed to scale dashboard deployment.', error)
        }
      },
    },
    {
      title: 'Scale \"postgres\" deployment to zero',
      enabled: (ctx: any) => ctx.isPostgresDeployed && !ctx.isPostgresStopped,
      task: async (_ctx: any, task: any) => {
        try {
          await this.kube.scaleDeployment(this.postgresDeploymentName, this.cheNamespace, 0)
          task.title = `${task.title}...done`
        } catch (error) {
          return newError('Failed to scale postgres deployment.', error)
        }
      },
    },
    {
      title: 'Scale \"devfile registry\" deployment to zero',
      enabled: (ctx: any) => ctx.isDevfileRegistryDeployed && !ctx.isDevfileRegistryStopped,
      task: async (_ctx: any, task: any) => {
        try {
          await this.kube.scaleDeployment(this.devfileRegistryDeploymentName, this.cheNamespace, 0)
          task.title = `${task.title}...done`
        } catch (error) {
          return newError('Failed to scale devfile registry deployment.', error)
        }
      },
    },
    {
      title: 'Scale \"plugin registry\" deployment to zero',
      enabled: (ctx: any) => ctx.isPluginRegistryDeployed && !ctx.isPluginRegistryStopped,
      task: async (_ctx: any, task: any) => {
        try {
          await this.kube.scaleDeployment(this.pluginRegistryDeploymentName, this.cheNamespace, 0)
          task.title = `${task.title}...done`
        } catch (error) {
          return newError('Failed to scale plugin registry deployment.', error)
        }
      },
    }]
  }

  /**
   * Returns tasks which remove all Eclipse Che related resources.
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete all deployments',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteAllDeployments(flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete all services',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteAllServices(flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete all ingresses',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteAllIngresses(flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete all routes',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.oc.deleteAllRoutes(flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete configmaps for Eclipse Che server and operator',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteConfigMap('che', flags.chenamespace)
          await this.kube.deleteConfigMap('che-operator', flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete rolebindings che, che-workspace-exec and che-workspace-view',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteRoleBinding('che', flags.chenamespace)
          await this.kube.deleteRoleBinding('che-operator', flags.chenamespace)
          await this.kube.deleteRoleBinding('che-workspace-exec', flags.chenamespace)
          await this.kube.deleteRoleBinding('che-workspace-view', flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete service accounts che, che-workspace',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteServiceAccount('che', flags.chenamespace)
          await this.kube.deleteServiceAccount('che-workspace', flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete PVCs',
        task: async (_ctx: any, task: any) => {
          await this.kube.deletePersistentVolumeClaim('postgres-data', flags.chenamespace)
          await this.kube.deletePersistentVolumeClaim('che-data-volume', flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete consoleLink ${this.cheConsoleLinkName}`,
        task: async (_ctx: any, task: any) => {
          const checlusters = await this.kube.getAllCheClusters()
          // Delete the consoleLink only in case if there no more checluster installed
          if (checlusters.length === 0) {
            await this.kube.deleteConsoleLink(this.cheConsoleLinkName)
          }
          task.title = `${task.title}...OK`
        },
      },
    ]
  }

  /**
   * Returns tasks which wait until pods are deleted.
   */
  waitPodsDeletedTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Wait until Eclipse Che Server pod is deleted',
        task: async (_ctx: any, task: any) => {
          await this.kube.waitUntilPodIsDeleted(this.cheSelector, this.cheNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait until Eclipse Che Dashboard pod is deleted',
        task: async (_ctx: any, task: any) => {
          await this.kube.waitUntilPodIsDeleted(this.dashboardSelector, this.cheNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait until PostgreSQL pod is deleted',
        task: async (_ctx: any, task: any) => {
          await this.kube.waitUntilPodIsDeleted(this.postgresSelector, this.cheNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait until Devfile Registry pod is deleted',
        task: async (_ctx: any, task: any) => {
          await this.kube.waitUntilPodIsDeleted(this.devfileRegistrySelector, this.cheNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait until Plug-in Registry pod is deleted',
        task: async (_ctx: any, task: any) => {
          await this.kube.waitUntilPodIsDeleted(this.pluginRegistrySelector, this.cheNamespace)
          task.title = `${task.title}...done.`
        },
      },
    ]
  }

  deleteNamespace(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: `Delete namespace ${flags.chenamespace}`,
      task: async (task: any) => {
        const namespaceExist = await this.kube.getNamespace(flags.chenamespace)
        if (namespaceExist) {
          await this.kube.deleteNamespace(flags.chenamespace)
        }
        task.title = `${task.title}...OK`
      },
    }]
  }

  verifyCheNamespaceExistsTask(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: `Verify if namespace '${flags.chenamespace}' exists`,
      task: async () => {
        if (!await this.kube.getNamespace(flags.chenamespace)) {
          command.error(`E_BAD_NS - Namespace does not exist.\nThe Kubernetes Namespace "${flags.chenamespace}" doesn't exist.`, { code: 'EBADNS' })
        }
      },
    }]
  }

  /**
   * Return tasks to collect Eclipse Che logs.
   */
  serverLogsTasks(flags: any, follow: boolean): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `${follow ? 'Start following' : 'Read'} logs`,
        task: async (ctx: any, task: any) => {
          await this.che.readPodLog(flags.chenamespace, CHE_OPERATOR_SELECTOR, ctx.directory, follow)
          await this.che.readPodLog(flags.chenamespace, this.cheSelector, ctx.directory, follow)
          await this.che.readPodLog(flags.chenamespace, this.postgresSelector, ctx.directory, follow)
          await this.che.readPodLog(flags.chenamespace, this.pluginRegistrySelector, ctx.directory, follow)
          await this.che.readPodLog(flags.chenamespace, this.devfileRegistrySelector, ctx.directory, follow)
          await this.che.readPodLog(flags.chenamespace, this.dashboardSelector, ctx.directory, follow)
          await this.che.readNamespaceEvents(flags.chenamespace, ctx.directory, follow)
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  debugTask(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Find Eclipse Che Server pod',
        task: async (ctx: any, task: any) => {
          const chePods = await this.kube.listNamespacedPod(flags.chenamespace, undefined, this.cheSelector)
          if (chePods.items.length === 0) {
            throw new Error(`Eclipse Che server pod not found in the namespace '${flags.chenamespace}'`)
          }
          ctx.podName = chePods.items[0].metadata!.name!
          task.title = `${task.title}...done`
        },
      },
      {
        title: 'Check if debug mode is enabled',
        task: async (task: any) => {
          const configMap = await this.kube.getConfigMap('che', flags.chenamespace)
          if (!configMap || configMap.data!.CHE_DEBUG_SERVER !== 'true') {
            throw new Error('Eclipse Che server should be redeployed with \'--debug\' flag')
          }

          task.title = `${task.title}...done`
        },
      },
      {
        title: `Forward port '${flags['debug-port']}'`,
        task: async (ctx: any, task: any) => {
          await this.kube.portForward(ctx.podName, flags.chenamespace, flags['debug-port'])
          task.title = `${task.title}...done`
        },
      },
    ]
  }

  preparePostInstallationOutput(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Prepare post installation output',
        task: async (ctx: any, task: any) => {
          const messages: string[] = []

          const version = await VersionHelper.getCheVersion(flags)
          messages.push(`Eclipse Che '${version.trim()}' has been successfully deployed.`)
          messages.push(`Documentation             : ${DOC_LINK}`)
          if (DOC_LINK_RELEASE_NOTES) {
            messages.push(`Release Notes           : ${DOC_LINK_RELEASE_NOTES}`)
          }
          messages.push(OUTPUT_SEPARATOR)

          const cheUrl = this.che.buildDashboardURL(await this.che.cheURL(flags.chenamespace))
          messages.push(`Users Dashboard           : ${cheUrl}`)

          const checluster = await this.kube.getCheClusterV1(flags.chenamespace)
          if (ctx.isOpenShift && checluster?.spec?.auth?.openShiftoAuth) {
            if (checluster?.status?.openShiftOAuthUserCredentialsSecret) {
              let user = ''
              let password = ''

              // read secret from the `openshift-config` namespace
              let credentialsSecret = await this.kube.getSecret(checluster.status.openShiftOAuthUserCredentialsSecret, 'openshift-config')
              if (credentialsSecret) {
                user = base64Decode(credentialsSecret.data!.user)
                password = base64Decode(credentialsSecret.data!.password)
              } else {
                // read legacy secret from the `flags.chenamespace` namespace
                credentialsSecret = await this.kube.getSecret(checluster.status.openShiftOAuthUserCredentialsSecret, flags.chenamespace)
                if (credentialsSecret) {
                  user = base64Decode(credentialsSecret.data!.user)
                  password = base64Decode(credentialsSecret.data!.password)
                }
              }

              if (user && password) {
                messages.push(`HTPasswd user credentials : "${user}:${password}".`)
              }
            }
          }
          messages.push(OUTPUT_SEPARATOR)

          const cheConfigMap = await this.kube.getConfigMap('che', flags.chenamespace)
          if (cheConfigMap && cheConfigMap.data) {
            if (cheConfigMap.data.CHE_WORKSPACE_PLUGIN__REGISTRY__URL) {
              messages.push(`Plug-in Registry          : ${addTrailingSlash(cheConfigMap.data.CHE_WORKSPACE_PLUGIN__REGISTRY__URL)}`)
            }
            if (cheConfigMap.data.CHE_WORKSPACE_DEVFILE__REGISTRY__URL) {
              messages.push(`Devfile Registry          : ${addTrailingSlash(cheConfigMap.data.CHE_WORKSPACE_DEVFILE__REGISTRY__URL)}`)
            }
            messages.push(OUTPUT_SEPARATOR)

            if (flags.platform === 'minikube') {
              messages.push('Dex user credentials      : che@eclipse.org:admin')
              messages.push('Dex user credentials      : user1@che:password')
              messages.push('Dex user credentials      : user2@che:password')
              messages.push('Dex user credentials      : user3@che:password')
              messages.push('Dex user credentials      : user4@che:password')
              messages.push('Dex user credentials      : user5@che:password')
              messages.push(OUTPUT_SEPARATOR)
            }
          }

          ctx.highlightedMessages = messages.concat(ctx.highlightedMessages)
          task.title = `${task.title}...done`
        },
      },
    ]
  }

  checkEclipseCheStatus(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Eclipse Che status check',
        task: async (ctx, task) => {
          const cheApi = CheApiClient.getInstance(ctx.cheURL + '/api')
          task.title = `${task.title}...done`
          return cheApi.isCheServerReady()
        },
      },
    ]
  }
}
