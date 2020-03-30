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
import { createNamespaceTask, createEclipeCheCluster, copyOperatorResources } from './common-tasks';

export class OLMTasks {

  sourceName = 'eclipse-che-preview'
  operatorGroupName = 'cheoperatorgroup'
  packageNamePrefix = 'eclipse-che-preview-'
  channel = this.getDefaultChannel()

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
        createNamespaceTask(flags),
        copyOperatorResources(flags, command.config.cacheDir),
        {
          title: "Create operator source",
          task: async (ctx: any, task: any) => {
              ctx.operatorRegistryNamespace = ctx.isOpenShift ? defaultOlmOpenshiftRegistryNamespace : defaultOmlKubernetesRegistryNamespace
              ctx.marketplaceNamespace = ctx.isOpenShift ? defaultOlmOpenshiftOperatorSourceNamespace : defaultOlmKubernetesOperatorSourceNamespace

              if (await kube.operatorSourceExists(this.sourceName, ctx.marketplaceNamespace)) {
                task.title += '...It already exists.'
              } else {
                await kube.createOperatorSource(this.sourceName, ctx.operatorRegistryNamespace, ctx.marketplaceNamespace)
              }
          }
        },
        {
          title: 'Create operator group',
          task: async (ctx: any, task: any) => {
            if (await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)) {
              task.title += '...It already exists.'
            } else {
              task.title += '...Create operator group'
              await kube.createOperatorGroup(this.operatorGroupName, flags.chenamespace)
            }
          }
        },
        {
          title: 'Create operator subscription',
          task: async (ctx: any, task: any) => {
            ctx.packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes') 
            if (await kube.operatorSubscriptionExists(ctx.packageName, flags.chenamespace)) {
              task.title += '...It already exists.'
            } else {
              await kube.createOperatorSubscription(ctx.packageName, flags.chenamespace, ctx.marketplaceNamespace, this.channel)
            }
         }
        },
        {
          title: 'Wait while subscription is ready',
          task: async (ctx: any, task: any) => {
            // Todo set time out ...
            const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, ctx.packageName, 60)
            ctx.installPlanName = installPlan.name
          }
        },
        {
          title: 'Approve installation',
          task: async (ctx: any, task: any) => {
            await kube.aproveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          }
        },
        {
          title: 'Wait while opertor installed',
          task: async (ctx: any, task: any) => {
            await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace, 30)
          }
        },
        createEclipeCheCluster(flags)
    ], { renderer: flags['listr-renderer'] as any })
  }

  updateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Approve installation',
        task: async (ctx: any, task: any) => {
          await kube.aproveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
        }
      },
      {
        title: 'Wait while newer operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitWhileOperatorInstalled(ctx.installPlanName, flags.chenamespace, 30)
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any, command?: Command): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
        {
          title: `Delete(OLM) operator source ${this.sourceName}`,
          task: async (ctx: any, task: any) => {
            if (await kube.operatorSourceExists(this.sourceName, flags.chenamespace)) {
              await kube.deleteOperatorSource(this.sourceName, flags.chenamespace)
            }
            task.title += '...OK'
          }
        },
        {
          title: `Delete(OLM) operator group ${this.operatorGroupName}`,
          task: async (ctx: any, task: any) => {
            if (await kube.operatorGroupExists(this.operatorGroupName, flags.chenamespace)) {
              await kube.deleteOperatorGroup(this.operatorGroupName, flags.chenamespace)
            }
            task.title += '...OK'
          }
        },
        {
          title: `Delete(OLM) operator subscription 'Todo package name...'`,
          task: async (ctx: any, task: any) => {
            // todo why do we need the same subscription name like package name. Are you sure? or move it upper.
            const packageName = this.packageNamePrefix + (ctx.isOpenShift ? 'openshift' : 'kubernetes') 

            if (await kube.operatorSubscriptionExists(packageName, flags.chenamespace)) {
              await kube.deleteOperatorSubscription(packageName, flags.chenamespace)
            }
            task.title += '...OK'
          }
        },
      ]
  }

  // To update chectl stable channel we are patching src/constants.ts from nightly to release version.
  // Let's use it to determine which olm channel should we use by default.
  // TODO: Fixme: take a look, maybe it is better to have chectl like field in the package.json...
  getDefaultChannel(): CheOLMChannel {
    if (DEFAULT_CHE_IMAGE.endsWith(':nightly')) {
      return CheOLMChannel.NIGHTLY
    }
    return CheOLMChannel.STABLE
  }
}

