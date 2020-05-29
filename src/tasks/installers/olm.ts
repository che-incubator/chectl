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
import { cli } from 'cli-ux'
import Listr = require('listr')

import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/typings/olm'
import { CUSTOM_CATALOG_SOURCE_NAME, CVS_PREFIX, DEFAULT_CHE_IMAGE, DEFAULT_CHE_OLM_PACKAGE_NAME, DEFAULT_OLM_KUBERNETES_NAMESPACE, DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE, KUBERNETES_OLM_CATALOG, OLM_STABLE_CHANNEL_NAME, OPENSHIFT_OLM_CATALOG, OPERATOR_GROUP_NAME, SUBSCRIPTION_NAME } from '../../constants'
import { isKubernetesPlatformFamily } from '../../util'

import { copyOperatorResources, createEclipseCheCluster, createNamespaceTask } from './common-tasks'

export class OLMTasks {
  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    if (this.isNightlyChectlChannel() && !flags['catalog-source-yaml']) {
      command.warn('A nightly channel for Eclipse Che is not available on OpenShift OLM catalog, the latest stable release will be deployed instead. To get a nightly release of Eclipse Che use the `operator` installer (--installer=operator).')
    }
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      copyOperatorResources(flags, command.config.cacheDir),
      createNamespaceTask(flags),
      {
        title: 'Create operator group',
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorGroup(OPERATOR_GROUP_NAME, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Configure context information',
        task: async (ctx: any, task: any) => {
          ctx.defaultCatalogSourceNamespace = isKubernetesPlatformFamily(flags.platform) ? DEFAULT_OLM_KUBERNETES_NAMESPACE : DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE
          // catalog source name for stable Che version
          ctx.catalogSourceNameStable = isKubernetesPlatformFamily(flags.platform) ? KUBERNETES_OLM_CATALOG : OPENSHIFT_OLM_CATALOG

          ctx.approvalStarategy = flags['auto-update'] ? 'Automatic' : 'Manual'

          ctx.sourceName = CUSTOM_CATALOG_SOURCE_NAME

          task.title = `${task.title}...done.`
        }
      },
      {
        enabled: () => flags['catalog-source-yaml'],
        title: 'Create custom catalog source from file',
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            const customCatalogSource: CatalogSource = kube.readCatalogSourceFromFile(flags['catalog-source-yaml'])
            customCatalogSource.metadata.name = ctx.sourceName
            customCatalogSource.metadata.namespace = flags.chenamespace
            await kube.createCatalogSource(customCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, CUSTOM_CATALOG_SOURCE_NAME)
            task.title = `${task.title}...created new one, with name ${CUSTOM_CATALOG_SOURCE_NAME} in the namespace ${flags.chenamespace}.`
          } else {
            task.title = `${task.title}...It already exists.`
          }
        }
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            let subscription: Subscription
            if (!flags['catalog-source-yaml']) {
              subscription = this.createSubscription(SUBSCRIPTION_NAME, DEFAULT_CHE_OLM_PACKAGE_NAME, flags.chenamespace, ctx.defaultCatalogSourceNamespace, OLM_STABLE_CHANNEL_NAME, ctx.catalogSourceNameStable, ctx.approvalStarategy, flags['starting-csv'])
            } else {
              subscription = this.createSubscription(SUBSCRIPTION_NAME, flags['package-manifest-name'], flags.chenamespace, flags.chenamespace, flags['olm-channel'], ctx.sourceName, ctx.approvalStarategy, flags['starting-csv'])
            }
            await kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, SUBSCRIPTION_NAME, 600)
          ctx.installPlanName = installPlan.name
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Approve installation',
        enabled: ctx => ctx.approvalStarategy === 'Manual',
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Wait while operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      createEclipseCheCluster(flags, kube)
    ], { renderer: flags['listr-renderer'] as any })
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      {
        title: 'Check if operator group exists',
        task: async (_ctx: any, task: any) => {
          if (!await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator group ${OPERATOR_GROUP_NAME}`)
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check if operator subscription exists',
        task: async (_ctx: any, task: any) => {
          if (!await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator subscription ${SUBSCRIPTION_NAME}`)
          }
          task.title = `${task.title}...done.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  updateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Get operator installation plan',
        task: async (ctx: any, task: any) => {
          const subscription: Subscription = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)

          if (subscription.status) {
            if (subscription.status.state === 'AtLatestKnown') {
              task.title = `Everything is up to date. Installed the latest known version '${subscription.status.currentCSV}'.`
              return
            }

            if (subscription.status.state === 'UpgradePending' && subscription.status!.conditions) {
              const installCondition = subscription.status.conditions.find(condition => condition.type === 'InstallPlanPending' && condition.status === 'True')
              if (installCondition) {
                ctx.installPlanName = subscription.status.installplan.name
                task.title = `${task.title}...done.`
                return
              }
            }
          }
          command.error('Unable to find installation plan to update.')
        }
      },
      {
        title: 'Approve installation',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Wait while newer operator installed',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, flags.chenamespace, 60)
          task.title = `${task.title}...done.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
      {
        title: 'Check if OLM is pre-installed on the platform',
        task: async (ctx: any, task: any) => {
          ctx.isPreInstalledOLM = await kube.isPreInstalledOLM() ? true : false
          task.title = `${task.title}: ${ctx.isPreInstalledOLM}...OK`
        }
      },
      {
        title: `Delete(OLM) operator subscription ${SUBSCRIPTION_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            await kube.deleteOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter(csv => csv.metadata.name.startsWith(CVS_PREFIX))
          csvsToDelete.forEach(csv => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name))
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator group ${OPERATOR_GROUP_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            await kube.deleteOperatorGroup(OPERATOR_GROUP_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) custom catalog source ${CUSTOM_CATALOG_SOURCE_NAME}`,
        task: async (_ctx: any, task: any) => {
          if (await kube.catalogSourceExists(CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            await kube.deleteCatalogSource(flags.chenamespace, CUSTOM_CATALOG_SOURCE_NAME)
          }
          task.title = `${task.title}...OK`
        }
      }
    ]
  }

  private isOlmPreInstalledTask(command: Command, kube: KubeHelper): Listr.ListrTask<Listr.ListrContext> {
    return {
      title: 'Check if OLM is pre-installed on the platform',
      task: async (_ctx: any, task: any) => {
        if (!await kube.isPreInstalledOLM()) {
          cli.warn('Looks like your platform hasn\'t got embedded OLM, so you should install it manually. For quick start you can use:')
          cli.url('install.sh', 'https://raw.githubusercontent.com/operator-framework/operator-lifecycle-manager/master/deploy/upstream/quickstart/install.sh')
          command.error('OLM is required for installation Eclipse Che with installer flag \'olm\'')
        }
        task.title = `${task.title}...done.`
      }
    }
  }

  private isNightlyChectlChannel(): boolean {
    if (DEFAULT_CHE_IMAGE.endsWith(':nightly')) {
      return true
    }
    return false
  }

  private createSubscription(name: string, packageName: string, namespace: string, sourceNamespace: string, channel: string, sourceName: string, installPlanApproval: string, startingCSV?: string): Subscription {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'Subscription',
      metadata: {
        name,
        namespace
      },
      spec: {
        channel,
        installPlanApproval,
        name: packageName,
        source: sourceName,
        sourceNamespace,
        startingCSV,
      }
    }
  }
}
