/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import {CheCtlContext, CliContext, EclipseCheContext} from '../context'
import * as Listr from 'listr'
import { KubeClient } from '../api/kube-client'
import {getEmbeddedTemplatesDirectory, isPartOfEclipseChe, newListr, safeLoadFromYamlFile} from '../utils/utls'
import * as path from 'path'
import { V1Role, V1RoleBinding } from '@kubernetes/client-node'
import * as yaml from 'js-yaml'
import {CommonTasks} from './common-tasks'
import {CHE_NAMESPACE_FLAG, CHE_OPERATOR_IMAGE_FLAG, CLUSTER_MONITORING_FLAG, DELETE_ALL_FLAG} from '../flags'
import {EclipseChe} from './installers/eclipse-che/eclipse-che'
import {PART_OF_ECLIPSE_CHE_SELECTOR} from '../constants'
import {DevWorkspace} from './installers/dev-workspace/dev-workspace'

export namespace OlmTasks {
  export async function getDeleteSubscriptionAndCatalogSourceTask(packageName: string, csvPrefix: string, namespace: string): Promise<Listr.ListrTask<any>> {
    let title = 'Delete Subscription'

    const kubeHelper = KubeClient.getInstance()
    const deleteResources = []

    // Subscription
    const subscription = await kubeHelper.getOperatorSubscriptionByPackage(packageName, namespace)
    if (subscription) {
      title = `${title} ${subscription.metadata.name}`
      deleteResources.push(() => kubeHelper.deleteOperatorSubscription(subscription.metadata.name!, namespace))

      // CatalogSource
      const catalogSource = await kubeHelper.getCatalogSource(subscription.spec.source, subscription.spec.sourceNamespace)
      if (isPartOfEclipseChe(catalogSource)) {
        title = `${title} and CatalogSource ${subscription.spec.source}`
        deleteResources.push(() => kubeHelper.deleteCatalogSource(subscription!.spec.source, subscription!.spec.sourceNamespace))
      }
    }

    const catalogSources = await kubeHelper.listCatalogSource(namespace, PART_OF_ECLIPSE_CHE_SELECTOR)
    for (const catalogSource of catalogSources) {
      deleteResources.push(() => kubeHelper.deleteCatalogSource(catalogSource.metadata.name!, catalogSource.metadata.namespace!))
    }

    // ClusterServiceVersion
    const csvs = await kubeHelper.getCSVWithPrefix(csvPrefix, namespace)
    for (const csv of csvs) {
      deleteResources.push(() => kubeHelper.deleteClusterServiceVersion(csv.metadata.name!, namespace))
    }

    return CommonTasks.getDeleteResourcesTask(title, deleteResources)
  }

  export function getDeleteOperatorsTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()
    const flags = CheCtlContext.getFlags()

    const deleteResources = [() => kubeHelper.deleteOperator(`${EclipseChe.PACKAGE}.${ctx[EclipseCheContext.OPERATOR_NAMESPACE]}`)]
    if (flags[DELETE_ALL_FLAG]) {
      deleteResources.push(() => kubeHelper.deleteOperator(`${DevWorkspace.PACKAGE}.${ctx[EclipseCheContext.OPERATOR_NAMESPACE]}`))
    }
    return CommonTasks.getDeleteResourcesTask('Delete Operators', deleteResources)
  }

  export function getCreateSubscriptionTask(
    name: string,
    namespace: string,
    catalogSource: string,
    catalogSourceNamespace: string,
    packageName: string,
    channel: string,
    approvalStrategy: string,
    startingCSV?: string
  ): Listr.ListrTask<any> {
    return {
      title: `Create Subscription ${name}`,
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        let subscription = await kubeHelper.getOperatorSubscription(name, namespace)
        const subscriptionExists = subscription !== undefined
        if (!subscriptionExists) {
          subscription = {
            apiVersion: 'operators.coreos.com/v1alpha1',
            kind: 'Subscription',
            metadata: {
              name: name,
              namespace: namespace,
              labels: {
                'app.kubernetes.io/part-of': 'che.eclipse.org',
              },
            },
            spec: {
              channel: channel,
              installPlanApproval: approvalStrategy,
              name: packageName,
              source: catalogSource,
              sourceNamespace: catalogSourceNamespace,
              startingCSV: startingCSV,
            },
          }
          await kubeHelper.createOperatorSubscription(subscription, namespace)
        }

        // wait for Subscription
        const installPlan = await kubeHelper.waitOperatorSubscriptionReadyForApproval(name, namespace, 600)

        // approve InstallPlan
        await kubeHelper.approveOperatorInstallationPlan(installPlan.name!, namespace)
        await kubeHelper.waitOperatorInstallPlan(installPlan.name!, namespace)

        // wait for CSV
        const installedCSVName = await kubeHelper.waitInstalledCSVInSubscription(name, namespace)
        const phase = await kubeHelper.waitCSVStatusPhase(installedCSVName, namespace)
        if (phase === 'Failed') {
          const csv = await kubeHelper.getCSV(installedCSVName, namespace)
          if (!csv) {
            throw new Error(`Cluster service version '${installedCSVName}' not found.`)
          }
          throw new Error(`Cluster service version resource failed, cause: ${csv.status.message}, reason: ${csv.status.reason}.`)
        }

        task.title = `${task.title}...[${subscriptionExists ? 'Exists' : 'Created'}]`
      },
    }
  }

  export function getCreateCatalogSourceTask(name: string, namespace: string, image: string): Listr.ListrTask<any> {
    return {
      title: `Create CatalogSource ${name}`,
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        if (!await kubeHelper.isCatalogSourceExists(name, namespace)) {
          const catalogSource =  {
            apiVersion: 'operators.coreos.com/v1alpha1',
            kind: 'CatalogSource',
            metadata: {
              name: name,
              namespace: namespace,
              labels: {
                'app.kubernetes.io/part-of': 'che.eclipse.org',
              },
            },
            spec: {
              image: image,
              sourceType: 'grpc',
              updateStrategy: {
                registryPoll: {
                  interval: '15m',
                },
              },
            },
          }
          await kubeHelper.createCatalogSource(catalogSource, namespace)
          await kubeHelper.waitCatalogSource(name, namespace)
          task.title = `${task.title}...[Created]`
        } else {
          task.title = `${task.title}...[Exists]`
        }
      },
    }
  }

  export function getCreatePrometheusRBACTask(): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    return {
      enabled: () => flags[CLUSTER_MONITORING_FLAG],
      title: `Create ${EclipseChe.PROMETHEUS} RBAC`,
      task: async (_ctx: any, _task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const roleYamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role.yaml')
        const role = safeLoadFromYamlFile(roleYamlFilePath) as V1Role

        const roleBindingYamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role-binding.yaml')
        const roleBinding = safeLoadFromYamlFile(roleBindingYamlFilePath) as V1RoleBinding

        const tasks = newListr()
        tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
          true,
          'Role',
          EclipseChe.PROMETHEUS,
          () => kubeHelper.isRoleExist(EclipseChe.PROMETHEUS, flags[CHE_NAMESPACE_FLAG]),
          () => kubeHelper.createRole(role, flags[CHE_NAMESPACE_FLAG]),
          () => kubeHelper.replaceRole(role, flags[CHE_NAMESPACE_FLAG]),
        ))
        tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
          true,
          'RoleBinding',
          EclipseChe.PROMETHEUS,
          () => kubeHelper.isRoleBindingExist(EclipseChe.PROMETHEUS, flags[CHE_NAMESPACE_FLAG]),
          () => kubeHelper.createRoleBinding(roleBinding, flags[CHE_NAMESPACE_FLAG]),
          () => kubeHelper.replaceRoleBinding(roleBinding, flags[CHE_NAMESPACE_FLAG]),
        ))
        return tasks
      },
    }
  }

  export function getApproveInstallPlanTask(subscriptionName: string): Listr.ListrTask<any> {
    return {
      title: `Approve InstallPlan for ${subscriptionName}`,
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const subscription = await kubeHelper.getOperatorSubscription(subscriptionName, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
        if (!subscription) {
          throw new Error(`Subscription ${subscriptionName} not found.`)
        }

        if (subscription.status) {
          if (subscription.status.state === 'AtLatestKnown') {
            task.title = `${task.title}...[Everything is up to date. Installed the latest known '${getVersionFromCSV(subscription.status.currentCSV)}' version]`
            return
          }

          if (subscription.status.state === 'UpgradeAvailable') {
            task.title = `${task.title}...[Upgrade is already in progress]`
            return
          }

          if (subscription.status.state === 'UpgradePending') {
            const installedCSV = subscription.status.installedCSV
            const currentCSV = subscription.status.currentCSV

            if (!subscription.status.installplan?.name) {
              throw new Error(`${EclipseChe.PRODUCT_NAME} InstallPlan name is empty.`)
            }

            await kubeHelper.approveOperatorInstallationPlan(subscription.status.installplan.name, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
            await kubeHelper.waitOperatorInstallPlan(subscription.status.installplan.name, ctx[EclipseCheContext.OPERATOR_NAMESPACE], 60)
            if (installedCSV) {
              ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES].push(`${subscription.spec.name} is upgraded from '${getVersionFromCSV(installedCSV)}' to '${getVersionFromCSV(currentCSV)}' version`)
            } else {
              ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES].push(`${subscription.spec.name} '${getVersionFromCSV(currentCSV)}' version installed`)
            }
            task.title = `${task.title}...[OK]`
            return
          }

          throw new Error(`Subscription in '${subscription.status.state}' state.`)
        }

        throw new Error('InstallPlan not found.')
      },
    }
  }

  export function getCheckInstallPlanApprovalStrategyTask(subscriptionName: string): Listr.ListrTask<any> {
    return {
      title: 'Check InstallPlan approval strategy',
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const subscription = await kubeHelper.getOperatorSubscription(subscriptionName, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
        if (!subscription) {
          throw new Error(`Subscription ${subscriptionName} not found.`)
        }

        if (subscription.spec.installPlanApproval === EclipseChe.APPROVAL_STRATEGY_AUTOMATIC) {
          task.title = `${task.title}...[${EclipseChe.APPROVAL_STRATEGY_AUTOMATIC}]`
          throw new Error(`Use \'chectl server:update\' command only with ${EclipseChe.APPROVAL_STRATEGY_MANUAL} InstallPlan approval strategy.`)
        }

        task.title = `${task.title}...[${EclipseChe.APPROVAL_STRATEGY_MANUAL}]`
      },
    }
  }

  export function getSetCustomEclipseCheOperatorImageTask(): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    return {
      title: 'Set custom operator image',
      enabled: () => flags[CHE_OPERATOR_IMAGE_FLAG],
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const csvs = await kubeHelper.getCSVWithPrefix(EclipseChe.CSV_PREFIX, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
        if (csvs.length !== 1) {
          throw new Error(`${EclipseChe.PRODUCT_NAME} operator CSV not found.`)
        }
        const jsonPatch = [{ op: 'replace', path: '/spec/install/spec/deployments/0/spec/template/spec/containers/0/image', value: flags[CHE_OPERATOR_IMAGE_FLAG] }]
        await kubeHelper.patchClusterServiceVersion(csvs[0].metadata.name!, csvs[0].metadata.namespace!, jsonPatch)
        task.title = `${task.title}...[OK]`
      },
    }
  }

  export function getFetchCheClusterSampleTask(): Listr.ListrTask<any> {
    return {
      title: 'Fetch CheCluster sample from a CSV',
      enabled: (ctx: any) => !ctx[EclipseCheContext.CUSTOM_CR],
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const subscription = await kubeHelper.getOperatorSubscription(EclipseChe.SUBSCRIPTION, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
        if (!subscription) {
          throw new Error(`Subscription ${EclipseChe.SUBSCRIPTION} not found.`)
        }

        const installedCSV = subscription.status!.installedCSV!
        const csv = await kubeHelper.getCSV(installedCSV, ctx[EclipseCheContext.OPERATOR_NAMESPACE])

        if (csv && csv.metadata.annotations) {
          const rawYaml = csv.metadata.annotations!['alm-examples']
          ctx[EclipseCheContext.DEFAULT_CR] = (yaml.load(rawYaml) as Array<any>).find(cr => kubeHelper.isCheClusterAPIV2(cr))
        } else {
          throw new Error(`Unable to fetch CheCluster CR sample ${!csv ? '' : 'from CSV: ' + csv.spec.displayName}`)
        }

        task.title = `${task.title}...[OK]`
      },
    }
  }

  function getVersionFromCSV(csvName: string): string {
    return csvName.substr(csvName.lastIndexOf('v') + 1)
  }
}
