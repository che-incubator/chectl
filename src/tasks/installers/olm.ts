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
import { CheOLMChannel, DEFAULT_CHE_IMAGE, defaultOlmOpenshiftRegistryNamespace, defaultOmlKubernetesRegistryNamespace, defaultOlmOpenshiftOperatorSourceNamespace, defaultOlmKubernetesOperatorSourceNamespace } from '../../constants';

import { KubeHelper } from '../../api/kube';
import { createNamespaceTask, createEclipeCheCluster, copyOperatorResources, checkPreCreatedTls, checkTlsSertificate } from './common-tasks';
import { SubscriptionStatusCondition, Subscription } from 'olm';

export class OLMTasks {

  OperatorSourceNamePrefix = 'eclipse-che-preview-'
  operatorGroupName = 'cheoperatorgroup'
  packageNamePrefix = 'eclipse-che-preview-'
  channel = this.getDefaultChannel()

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      copyOperatorResources(flags, command.config.cacheDir),  
      createNamespaceTask(flags),
      checkPreCreatedTls(flags, kube),
      checkTlsSertificate(flags),
      {
        title: "Create operator source",
        task: async (ctx: any, task: any) => {
            ctx.operatorRegistryNamespace = ctx.isOpenShift ? defaultOlmOpenshiftRegistryNamespace : defaultOmlKubernetesRegistryNamespace
            ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOlmOpenshiftOperatorSourceNamespace : defaultOlmKubernetesOperatorSourceNamespace
            ctx.operatorSourceName = this.OperatorSourceNamePrefix + flags.chenamespace

            if (await kube.operatorSourceExists(ctx.operatorSourceName, ctx.marketplaceNamespace)) {
              task.title = `${task.title}...It already exists.`
            } else {
              await kube.createOperatorSource(ctx.operatorSourceName, ctx.operatorRegistryNamespace, ctx.marketplaceNamespace)
              task.title = `${task.title}...OK`
            }
        }
      },
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
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes')
          if (await kube.operatorSubscriptionExists(ctx.packageName, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorSubscription(ctx.packageName, flags.chenamespace, ctx.marketplaceNamespace, this.channel, ctx.operatorSourceName)
            task.title = `${task.title}...OK`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, ctx.packageName)
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
      {
        title: 'Check if operator source exists',
        task: async (ctx: any, task: any) => {
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOlmOpenshiftOperatorSourceNamespace : defaultOlmKubernetesOperatorSourceNamespace
          ctx.operatorSourceName = this.OperatorSourceNamePrefix + flags.chenamespace
          if (!await kube.operatorSourceExists(ctx.operatorSourceName, ctx.marketplaceNamespace)) {
            command.error(`Unable to find operator source ${ctx.operatorSourceName}`)
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
          await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace)
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any, command?: Command): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
      {
        title: `Delete(OLM) operator subscription 'Todo package name...'`,
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
        task: async (ctx: any, task: any) => {
          if (await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)) {
            await kube.deleteOperatorGroup(this.operatorGroupName, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator source ${this.OperatorSourceNamePrefix}`, // todo use name instead of prefix
        task: async (ctx: any, task: any) => {
          // todo, maybe we should deploy source to the the same namespace with Che?
          ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOlmOpenshiftOperatorSourceNamespace : defaultOlmKubernetesOperatorSourceNamespace
          const operatorSourceName = this.OperatorSourceNamePrefix + flags.chenamespace
          if (await kube.operatorSourceExists(operatorSourceName, ctx.marketplaceNamespace)) {
            await kube.deleteOperatorSource(operatorSourceName, ctx.marketplaceNamespace)
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
}

