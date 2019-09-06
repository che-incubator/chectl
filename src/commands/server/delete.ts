/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { cli } from 'cli-ux'
import * as commandExists from 'command-exists'

import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { cheNamespace, listrRenderer } from '../../common-flags'
import { HelmHelper } from '../../installers/helm'
import { MinishiftAddonHelper } from '../../installers/minishift-addon'

export default class Delete extends Command {
  static description = 'delete any Che related resource: Kubernetes/OpenShift/Helm'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Delete)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const kh = new KubeHelper(flags)
    const oh = new OpenShiftHelper()
    const helm = new HelmHelper()
    const msAddon = new MinishiftAddonHelper()
    const tasks = new Listr([
      {
        title: 'Verify Kubernetes API',
        task: async (ctx: any, task: any) => {
          try {
            await kh.checkKubeApi()
            ctx.isOpenShift = await kh.isOpenShift()
            task.title = await `${task.title}...OK`
            if (ctx.isOpenShift) {
              task.title = await `${task.title} (it's OpenShift)`
            }
          } catch (error) {
            this.error(`Failed to connect to Kubernetes API. ${error.message}`)
          }
        }
      },
      {
        title: 'Delete the CR eclipse-che of type checlusters.org.eclipse.che',
        task: async (_ctx: any, task: any) => {
          if (await kh.crdExist('checlusters.org.eclipse.che') &&
            await kh.cheClusterExist('eclipse-che', flags.chenamespace)) {
            await kh.deleteCheCluster('eclipse-che', flags.chenamespace)
            await cli.wait(2000) //wait a couple of secs for the finalizers to be executed
            task.title = await `${task.title}...OK`
          } else {
            task.title = await `${task.title}...CR not found`
          }
        }
      },
      {
        title: 'Delete all deployment configs',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await oh.deleteAllDeploymentConfigs(flags.chenamespace)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all deployments',
        task: async (_ctx: any, task: any) => {
          await kh.deleteAllDeployments(flags.chenamespace)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete CRD checlusters.org.eclipse.che',
        task: async (_ctx: any, task: any) => {
          if (await kh.crdExist('checlusters.org.eclipse.che')) {
            await kh.deleteCrd('checlusters.org.eclipse.che')
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all services',
        task: async (_ctx: any, task: any) => {
          await kh.deleteAllServices(flags.chenamespace)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all ingresses',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await kh.deleteAllIngresses(flags.chenamespace)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all routes',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await oh.deleteAllRoutes(flags.chenamespace)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete configmaps che and che-operator',
        task: async (_ctx: any, task: any) => {
          if (await kh.configMapExist('che', flags.chenamespace)) {
            await kh.deleteConfigMap('che', flags.chenamespace)
          }
          if (await kh.configMapExist('che-operator', flags.chenamespace)) {
            await kh.deleteConfigMap('che-operator', flags.chenamespace)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete role che-operator',
        task: async (_ctx: any, task: any) => {
          if (await kh.roleExist('che-operator', flags.chenamespace)) {
            await kh.deleteRole('che-operator', flags.chenamespace)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete cluster role che-operator',
        task: async (_ctx: any, task: any) => {
          if (await kh.clusterRoleExist('che-operator')) {
            await kh.deleteClusterRole('che-operator')
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete rolebindings che, che-operator, che-workspace-exec and che-workspace-view',
        task: async (_ctx: any, task: any) => {
          if (await kh.roleBindingExist('che', flags.chenamespace)) {
            await kh.deleteRoleBinding('che', flags.chenamespace)
          }
          if (await kh.roleBindingExist('che-operator', flags.chenamespace)) {
            await kh.deleteRoleBinding('che-operator', flags.chenamespace)
          }
          if (await kh.roleBindingExist('che-workspace-exec', flags.chenamespace)) {
            await kh.deleteRoleBinding('che-workspace-exec', flags.chenamespace)
          }
          if (await kh.roleBindingExist('che-workspace-view', flags.chenamespace)) {
            await kh.deleteRoleBinding('che-workspace-view', flags.chenamespace)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete cluster role binding che-operator',
        task: async (_ctx: any, task: any) => {
          if (await kh.clusterRoleBindingExist('che-operator')) {
            await kh.deleteClusterRoleBinding('che-operator')
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete service accounts che, che-operator, che-workspace',
        task: async (_ctx: any, task: any) => {
          if (await kh.serviceAccountExist('che', flags.chenamespace)) {
            await kh.deleteServiceAccount('che', flags.chenamespace)
          }
          if (await kh.roleBindingExist('che-operator', flags.chenamespace)) {
            await kh.deleteServiceAccount('che-operator', flags.chenamespace)
          }
          if (await kh.roleBindingExist('che-workspace', flags.chenamespace)) {
            await kh.deleteServiceAccount('che-workspace', flags.chenamespace)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete PVC postgres-data and che-data-volume',
        task: async (_ctx: any, task: any) => {
          if (await kh.persistentVolumeClaimExist('che-operator', flags.chenamespace)) {
            await kh.deletePersistentVolumeClaim('postgres-data', flags.chenamespace)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Purge che Helm chart',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          if (await !commandExists.sync('helm')) {
            task.title = await `${task.title}...OK (Helm not found)`
          } else {
            await helm.purgeHelmChart('che')
            task.title = await `${task.title}...OK`
          }
        }
      },
      {
        title: 'Remove Che minishift addon',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          if (!commandExists.sync('minishift')) {
            task.title = await `${task.title}...OK (minishift not found)`
          } else {
            await msAddon.removeAddon()
            task.title = await `${task.title}...OK`
          }
        }
      },
    ], { renderer: flags['listr-renderer'] as any })

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:update has completed.'
    })

    this.exit(0)
  }
}
