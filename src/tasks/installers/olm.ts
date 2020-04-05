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
import { CheOLMChannel, DEFAULT_CHE_IMAGE, openshiftApplicationPreviewRegistryNamespace, kubernetesApplicationPreviewRegistryNamespace, defaultOpenshiftMarketPlaceNamespace, defaultKubernetesMarketPlaceNamespace, defaultOLMNamespace } from '../../constants';

import { KubeHelper } from '../../api/kube';
import { createNamespaceTask, createEclipeCheCluster, copyOperatorResources, checkPreCreatedTls, checkTlsSertificate } from './common-tasks';
import { SubscriptionStatusCondition, Subscription, CatalogSource } from 'olm';

export class OLMTasks {

  private operatorSourceName = 'eclipse-che1'
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
        title: "Create operator source",
        task: async (ctx: any, task: any) => {
            ctx.operatorRegistryNamespace = ctx.isOpenShift ? openshiftApplicationPreviewRegistryNamespace : kubernetesApplicationPreviewRegistryNamespace
            ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOpenshiftMarketPlaceNamespace : defaultKubernetesMarketPlaceNamespace

            if (await kube.operatorSourceExists(this.operatorSourceName, ctx.marketplaceNamespace)) {
              task.title = `${task.title}...It already exists.`
            } else {
              await kube.createOperatorSource(this.operatorSourceName, ctx.operatorRegistryNamespace, ctx.marketplaceNamespace)
              await kube.waitCatalogSource(ctx.marketplaceNamespace, this.operatorSourceName)
              task.title = `${task.title}...OK`
            }
        }
      },
      {
        title: "Create catalog source",
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(this.operatorSourceName, defaultOLMNamespace)) {
            const catalogSourceInTheMarketPlaceNamespace = await kube.getCatalogSource(this.operatorSourceName, ctx.marketplaceNamespace)
            const catalogSource: CatalogSource = {
              apiVersion: 'operators.coreos.com/v1alpha1',
              kind: 'CatalogSource',
              metadata: {
                name: this.operatorSourceName,
                namespace: defaultOLMNamespace,
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
            await kube.waitCatalogSource(defaultOLMNamespace, this.operatorSourceName)
          }
        }
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes')
          if (await kube.operatorSubscriptionExists(ctx.packageName, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorSubscription(ctx.packageName, flags.chenamespace, ctx.marketplaceNamespace, this.channel, this.operatorSourceName)
            task.title = `${task.title}...OK`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, ctx.packageName, 600)
          ctx.installPlanName = installPlan.name
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Approve installation',
        task: async (ctx: any, task: any) => {
          await kube.aproveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
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
        task: async (ctx: any, task: any) => {
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOpenshiftMarketPlaceNamespace : defaultKubernetesMarketPlaceNamespace
          if (!await kube.operatorSourceExists(this.operatorSourceName, ctx.marketplaceNamespace)) {
            command.error(`Unable to find operator source ${this.operatorSourceName}`)
          }
        }
      },
      {
        title: 'Check if operator group exists',
        task: async (ctx: any, task: any) => {
          if (!await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)){
            command.error(`Unable to find operator group ${this.operatorGroupName}`)
          }
        }
      },
      {
        title: 'Check if operator subscription exists',
        task: async (ctx: any, task: any) => {
          ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes')
          if (!await kube.operatorSubscriptionExists(ctx.packageName, flags.chenamespace)) {
            command.error(`Unable to find operator subscription ${ctx.packageName}`)
          }
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
          ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes')
          const subscription: Subscription = await kube.getOperatorSubscription(ctx.packageName, flags.chenamespace)
          if (subscription.status && subscription.status!.conditions) {
            const installationCondition = subscription.status.conditions.find((condition: SubscriptionStatusCondition) => {
              return condition.type === 'InstallPlanPending' && condition.status === 'True'
            })
            if (installationCondition) {
              ctx.installPlanName = subscription.status.installplan.name
              return 
            }
          }
          command.error("Unable to find installation plan to update.")
        }
      },
      {
        title: 'Approve installation',
        task: async (ctx: any, task: any) => {
          await kube.aproveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
        }
      },
      {
        title: 'Wait while newer operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace, 60)
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
      {
        title: "Check if OLM is pre-installed on the platform",
        task: async  (ctx: any, task: any) => {
          ctx.isPreInstalledOLM = await kube.isPreInstalledOLM() ? true : false
        }
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter((csv) => csv.metadata.name.startsWith("eclipse-che"))
          csvsToDelete.forEach((csv) => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name))
        }
      },
      {
        title: `Delete(OLM) operator subscription 'Todo package name...'`,
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          // todo why do we need the same subscription name like package name. Are you sure? or move it upper.
          const packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes') 
          if (await kube.operatorSubscriptionExists(packageName, flags.chenamespace)) {
            await kube.deleteOperatorSubscription(packageName, flags.chenamespace)
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
      },
      {
        title: `Delete(OLM) operator source ${this.operatorSourceName}`,
        enabled: (ctx) => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOpenshiftMarketPlaceNamespace : defaultKubernetesMarketPlaceNamespace
          if (await kube.operatorSourceExists(this.operatorSourceName, ctx.marketplaceNamespace)) {
            await kube.deleteOperatorSource(this.operatorSourceName, ctx.marketplaceNamespace)
          }
          task.title = `${task.title}...OK`
        }
      }
    ]
  }

  // To update chectl stable channel we are patching src/constants.ts from nightly to release version.
  // Let's use it to determine which olm channel should we use by default.
  getDefaultChannel(): CheOLMChannel {
    if (DEFAULT_CHE_IMAGE.endsWith(':nightly')) {
      return CheOLMChannel.NIGHTLY
    }
    return CheOLMChannel.STABLE
  }

  isOlmPreInstalledTask(flags: any, command: Command, kube: KubeHelper): Listr.ListrTask<Listr.ListrContext> {
    return {
      title: "Check if OLM is pre-installed on the platform",
      task: async  (ctx: any, task: any) => {
        if (!await kube.isPreInstalledOLM()) {
          command.error("OLM isn't installed on your platfrom. If your platform hasn't got embedded OML, you need install it manually.")
        }
      }
    }
  }
}

