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
import { DEFAULT_CHE_IMAGE, DEFAULT_CHE_OLM_PACKAGE_NAME, defaultOLMKubernetesNamespace, defaultOpenshiftMarketPlaceNamespace, OLM_STABLE_CHANNEL_NAME } from '../../constants'
import { isKubernetesPlatformFamily } from '../../util'

import { checkTlsCertificate, copyOperatorResources, createEclipseCheCluster, createNamespaceTask } from './common-tasks'

export class OLMTasks {
  public static readonly CUSTOM_CATALOG_SOURCE_NAME = 'eclipse-che-custom-catalog-source'
  public static readonly SUBSCRIPTION_NAME = 'eclipse-che-subscription'
  public static readonly OPERATOR_GROUP_NAME = 'che-operator-group'

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    if (this.isNightlyChectlChannel() && !flags['catalog-source-yaml']) {
      command.warn('OLM catalog hasn\'t got nightly channel, that\'s why will be deployed stable Eclipse Che.')
    }
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      copyOperatorResources(flags, command.config.cacheDir),
      createNamespaceTask(flags),
      checkTlsCertificate(flags),
      {
        title: 'Create operator group',
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OLMTasks.OPERATOR_GROUP_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorGroup(OLMTasks.OPERATOR_GROUP_NAME, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Configure context information',
        task: async (ctx: any, task: any) => {
          ctx.defaultCatalogSourceNamespace = isKubernetesPlatformFamily(flags.platform) ? defaultOLMKubernetesNamespace : defaultOpenshiftMarketPlaceNamespace
          // catalog source name for stable Che version
          ctx.catalogSourceNameStable = isKubernetesPlatformFamily(flags.platform) ? 'operatorhubio-catalog' : 'community-operators'

          ctx.approvalStarategy = flags['auto-update'] ? 'Automatic' : 'Manual'

          ctx.sourceName = OLMTasks.CUSTOM_CATALOG_SOURCE_NAME

          task.title = `${task.title}...done.`
        }
      },
      {
        enabled: () => flags['catalog-source-yaml'],
        title: 'Create custom catalog source from file',
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(OLMTasks.CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            const customCatalogSource: CatalogSource = kube.readCatalogSourceFromFile(flags['catalog-source-yaml'])
            customCatalogSource.metadata.name = ctx.sourceName
            customCatalogSource.metadata.namespace = flags.chenamespace
            await kube.createCatalogSource(customCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, OLMTasks.CUSTOM_CATALOG_SOURCE_NAME)
            task.title = `${task.title}...created new one, with name ${OLMTasks.CUSTOM_CATALOG_SOURCE_NAME} in the namespace ${flags.chenamespace}.`
          } else {
            task.title = `${task.title}...It already exists.`
          }
        }
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            let subscription: Subscription
            if (!flags['catalog-source-yaml']) {
              subscription = this.createSubscription(OLMTasks.SUBSCRIPTION_NAME, DEFAULT_CHE_OLM_PACKAGE_NAME, flags.chenamespace, ctx.defaultCatalogSourceNamespace, OLM_STABLE_CHANNEL_NAME, ctx.catalogSourceNameStable, ctx.approvalStarategy, flags['starting-csv'])
            } else {
              subscription = this.createSubscription(OLMTasks.SUBSCRIPTION_NAME, flags['package-manifest-name'], flags.chenamespace, flags.chenamespace, flags['olm-channel'], ctx.sourceName, ctx.approvalStarategy, flags['starting-csv'])
            }
            await kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, OLMTasks.SUBSCRIPTION_NAME, 600)
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
          if (!await kube.operatorGroupExists(OLMTasks.OPERATOR_GROUP_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator group ${OLMTasks.OPERATOR_GROUP_NAME}`)
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check if operator subscription exists',
        task: async (_ctx: any, task: any) => {
          if (!await kube.operatorSubscriptionExists(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator subscription ${OLMTasks.SUBSCRIPTION_NAME}`)
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
          const subscription: Subscription = await kube.getOperatorSubscription(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)

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
        title: `Delete(OLM) operator subscription ${OLMTasks.SUBSCRIPTION_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)) {
            await kube.deleteOperatorSubscription(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter(csv => csv.metadata.name.startsWith('eclipse-che'))
          csvsToDelete.forEach(csv => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name))
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator group ${OLMTasks.OPERATOR_GROUP_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OLMTasks.OPERATOR_GROUP_NAME, flags.chenamespace)) {
            await kube.deleteOperatorGroup(OLMTasks.OPERATOR_GROUP_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) custom catalog source ${OLMTasks.CUSTOM_CATALOG_SOURCE_NAME}`,
        task: async (_ctx: any, task: any) => {
          if (await kube.catalogSourceExists(OLMTasks.CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            await kube.deleteCatalogSource(flags.chenamespace, OLMTasks.CUSTOM_CATALOG_SOURCE_NAME)
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
