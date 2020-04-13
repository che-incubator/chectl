/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command';
import Listr = require('listr');
import { CheOLMChannel, DEFAULT_CHE_IMAGE, openshiftApplicationPreviewRegistryNamespace, kubernetesApplicationPreviewRegistryNamespace, defaultOpenshiftMarketPlaceNamespace, defaultKubernetesMarketPlaceNamespace, defaultOLMKubernetesNamespace } from '../../constants';

import { KubeHelper } from '../../api/kube';
import { createNamespaceTask, createEclipeCheCluster, copyOperatorResources, checkPreCreatedTls, checkTlsSertificate } from './common-tasks';
import { Subscription, CatalogSource } from 'olm';
import { isKubernetesPlatformFamily } from '../../util';

export class OLMTasks {

  private operatorSourceName = 'eclipse-che'
  private subscriptionName = 'eclipse-che-subscription'
  private operatorGroupName = 'che-operator-group'
  private packageNamePrefix = 'eclipse-che-preview-'
  private channel = this.getDefaultChannel()

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(flags, command, kube),
      copyOperatorResources(flags, command.config.cacheDir),  
      createNamespaceTask(flags),
      checkPreCreatedTls(flags, kube),
      checkTlsSertificate(flags),
      {
        title: 'Create operator group',
        task: async (ctx: any, task: any) => {
          if (await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorGroup(this.operatorGroupName, flags.chenamespace)
            task.title = `${task.title}...OK`
          }
        }
      },
      {
        title: 'Configure context information',
        task: async (ctx: any, task: any) => {
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOpenshiftMarketPlaceNamespace : defaultKubernetesMarketPlaceNamespace
          // Todo: should we do check for installer openshift? flags.platform === 'crc' || flags.platform === 'openshift'
          ctx.defaultCatalogSourceNamespace = flags.platform === 'crc' ? defaultOpenshiftMarketPlaceNamespace : defaultOLMKubernetesNamespace
          // preview package name
          ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes')
          // catalog source name for stable Che version
          ctx.catalogSourceNameStable = isKubernetesPlatformFamily(flags.platform) ? 'operatorhubio-catalog' : 'community-operators'
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Create custom catalog source for "nightly" channel',
        enabled: () => this.channel === CheOLMChannel.NIGHTLY,
        task: async (ctx: any, task: any) => {
          await this.customCatalogTasks(flags, command, kube).run(ctx)
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(this.subscriptionName, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            var subscription: Subscription
            if (this.channel === CheOLMChannel.STABLE) {
                subscription = this.createSubscription(this.subscriptionName, 'eclipse-che', flags.chenamespace, ctx.defaultCatalogSourceNamespace, 'stable', ctx.catalogSourceNameStable)
            } else {
              subscription = this.createSubscription(this.subscriptionName, ctx.packageName, flags.chenamespace, ctx.defaultCatalogSourceNamespace, this.channel, this.operatorSourceName)
            }
            await kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...OK`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, this.subscriptionName, 600)
          ctx.installPlanName = installPlan.name
          task.title = `${task.title}...OK.`
        }
      },
      {
        title: 'Approve installation',
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Wait while operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...OK`
        }
      },
      createEclipeCheCluster(flags)
    ], { renderer: flags['listr-renderer'] as any })
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(flags, command, kube),
      {
        title: 'Check if operator source exists',
        enabled: () => this.channel === CheOLMChannel.NIGHTLY,
        task: async (ctx: any, task: any) => {
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOpenshiftMarketPlaceNamespace : defaultKubernetesMarketPlaceNamespace
          if (!await kube.operatorSourceExists(this.operatorSourceName, ctx.marketplaceNamespace)) {
            command.error(`Unable to find operator source ${this.operatorSourceName}`)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Check if operator group exists',
        task: async (ctx: any, task: any) => {
          if (!await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)){
            command.error(`Unable to find operator group ${this.operatorGroupName}`)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Check if operator subscription exists',
        task: async (ctx: any, task: any) => {
          if (!await kube.operatorSubscriptionExists(this.subscriptionName, flags.chenamespace)) {
            command.error(`Unable to find operator subscription ${this.subscriptionName}`)
          }
          task.title = `${task.title}...OK`
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
          const subscription: Subscription = await kube.getOperatorSubscription(this.subscriptionName, flags.chenamespace)

          if (subscription.status) {
            if (subscription.status.state === 'AtLatestKnown') {
              task.title = `Everything is up to date. Installed the latest known version '${subscription.status.currentCSV}' from channel '${this.channel}.`
              return
            }

            if (subscription.status.state === 'UpgradePending' && subscription.status!.conditions) {
              const installCondition = subscription.status.conditions.find(condition => condition.type === 'InstallPlanPending' && condition.status === 'True')
              if (installCondition) {
                ctx.installPlanName = subscription.status.installplan.name
                task.title = `${task.title}...OK`
                return
              }
            }
          }
          command.error("Unable to find installation plan to update.")
        }
      },
      {
        title: 'Approve installation',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
        }
      },
      {
        title: 'Wait while newer operator installed',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any) => {
          await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace, 60)
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
      {
        title: "Check if OLM is pre-installed on the platform",
        task: async  (ctx: any, task: any) => {
          ctx.isPreInstalledOLM = await kube.isPreInstalledOLM() ? true : false
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter((csv) => csv.metadata.name.startsWith("eclipse-che"))
          csvsToDelete.forEach((csv) => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name))
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator subscription ${this.subscriptionName}`,
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(this.subscriptionName, flags.chenamespace)) {
            await kube.deleteOperatorSubscription(this.subscriptionName, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator group ${this.operatorGroupName}`,
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          if (await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)) {
            await kube.deleteOperatorGroup(this.operatorGroupName, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      }
    ]
  }

  // To update chectl stable channel we are patching src/constants.ts from nightly to release version.
  // Let's use it to determine which olm channel should we use by default.
  private getDefaultChannel(): CheOLMChannel {
    if (DEFAULT_CHE_IMAGE.endsWith(':nightly')) {
      return CheOLMChannel.NIGHTLY
    }
    return CheOLMChannel.STABLE
  }

  private isOlmPreInstalledTask(flags: any, command: Command, kube: KubeHelper): Listr.ListrTask<Listr.ListrContext> {
    return {
      title: "Check if OLM is pre-installed on the platform",
      task: async  (ctx: any, task: any) => {
        if (!await kube.isPreInstalledOLM()) {
          command.error("OLM isn't installed on your platfrom. If your platform hasn't got embedded OML, you need install it manually.")
        }
        task.title = `${task.title}...OK`
      }
    }
  }

  private customCatalogTasks(flags: any, command: Command, kube: KubeHelper): Listr {
    return new Listr([
      {
        title: "Create operator source",
        task: async (ctx: any, task: any) => {
          const applicationRegistryNamespace = ctx.isOpenShift ? openshiftApplicationPreviewRegistryNamespace
                                                               : kubernetesApplicationPreviewRegistryNamespace
            if (await kube.operatorSourceExists(this.operatorSourceName, ctx.marketplaceNamespace)) {
              task.title = `${task.title}...It already exists.`
            } else {
              await kube.createOperatorSource(this.operatorSourceName, applicationRegistryNamespace, ctx.marketplaceNamespace)
              await kube.waitCatalogSource(ctx.marketplaceNamespace, this.operatorSourceName)
              task.title = `${task.title}...OK`
            }
        }
      },
      {
        title: "Create catalog source",
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(this.operatorSourceName, ctx.defaultCatalogSourceNamespace)) {
            const catalogSourceInTheMarketPlaceNamespace = await kube.getCatalogSource(this.operatorSourceName, ctx.marketplaceNamespace)

            const catalogSource: CatalogSource = {
              apiVersion: 'operators.coreos.com/v1alpha1',
              kind: 'CatalogSource',
              metadata: {
                name: this.operatorSourceName,
                namespace: ctx.defaultCatalogSourceNamespace,
              },
              spec: {
                address: catalogSourceInTheMarketPlaceNamespace.spec.address,
                base64data: '',
                mediatype: '',
                sourceType: 'grpc'
              }
            }
            // Create catalog source in the olm namespace to make it working in the namespace differ than marketplace
            await kube.createCatalogSource(catalogSource)
            await kube.waitCatalogSource(ctx.defaultCatalogSourceNamespace, this.operatorSourceName)
            task.title = `${task.title}...OK`
          } else {
            task.title = `${task.title}...It already exists.`
          }
        }
      }
    ])
  }

  private createSubscription(name: string, packageName: string, namespace: string, sourceNamespace: string, channel: string, sourceName: string): Subscription {
    return {
      apiVersion: "operators.coreos.com/v1alpha1",
      kind: 'Subscription',
      metadata: {
        name: name,
        namespace
      },
      spec: {
        channel,
        installPlanApproval: 'Manual',
        name: packageName,
        source: sourceName,
        sourceNamespace,
      }
    }
  }
}
