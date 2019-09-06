/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { Command } from '@oclif/command'
import { cli } from 'cli-ux'
import * as execa from 'execa'
import { mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import { ncp } from 'ncp'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'

export class OperatorTasks {
  operatorServiceAccount = 'che-operator'
  operatorRole = 'che-operator'
  operatorClusterRole = 'che-operator'
  operatorRoleBinding = 'che-operator'
  operatorClusterRoleBinding = 'che-operator'
  operatorCrd = 'checlusters.org.eclipse.che'
  operatorName = 'che-operator'
  operatorCheCluster = 'eclipse-che'
  resourcesPath = ''

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const che = new CheHelper(flags)
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Copying operator resources',
        task: async (_ctx: any, task: any) => {
          this.resourcesPath = await this.copyCheOperatorResources(flags.templates, command.config.cacheDir)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Create Namespace (${flags.chenamespace})`,
        task: async (_ctx: any, task: any) => {
          const exist = await che.cheNamespaceExist(flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else if (flags.platform === 'minikube' || flags.platform === 'k8s' || flags.platform === 'microk8s') {
            await execa(`kubectl create namespace ${flags.chenamespace}`, { shell: true })
            task.title = `${task.title}...done.`
          } else if (flags.platform === 'minishift' || flags.platform === 'openshift') {
            await execa(`oc new-project ${flags.chenamespace}`, { shell: true })
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = this.resourcesPath + 'service_account.yaml'
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create Role ${this.operatorRole} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.roleExist(this.operatorRole, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = this.resourcesPath + 'role.yaml'
            const statusCode = await kube.createRoleFromFile(yamlFilePath, flags.chenamespace)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.operatorClusterRole}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.clusterRoleExist(this.operatorClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = this.resourcesPath + 'cluster_role.yaml'
            const statusCode = await kube.createClusterRoleFromFile(yamlFilePath)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create RoleBinding ${this.operatorRoleBinding} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.roleBindingExist(this.operatorRoleBinding, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = this.resourcesPath + 'role_binding.yaml'
            await kube.createRoleBindingFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRoleBinding ${this.operatorClusterRoleBinding}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.clusterRoleBindingExist(this.operatorRoleBinding)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createClusterRoleBinding(this.operatorClusterRoleBinding, this.operatorServiceAccount, flags.chenamespace, this.operatorClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create CRD ${this.operatorCrd}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.crdExist(this.operatorCrd)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = this.resourcesPath + 'crds/org_v1_che_crd.yaml'
            await kube.createCrdFromFile(yamlFilePath)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Waiting 5 seconds for the new Kubernetes resources to get flushed',
        task: async (_ctx: any, task: any) => {
          await cli.wait(5000)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Create deployment ${this.operatorName} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.deploymentExist(this.operatorName, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createDeploymentFromFile(this.resourcesPath + 'operator.yaml', flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create Che Cluster ${this.operatorCheCluster} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.cheClusterExist(this.operatorCheCluster, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            // Che Operator supports only Multi-User Che
            ctx.isCheDeployed = true
            ctx.isPostgresDeployed = true
            ctx.isKeycloakDeployed = true

            // plugin and devfile registry will be deployed only when external ones are not configured
            ctx.isPluginRegistryDeployed = !(flags['plugin-registry-url'] as boolean)
            ctx.isDevfileRegistryDeployed = !(flags['devfile-registry-url'] as boolean)

            const yamlFilePath = flags['che-operator-cr-yaml'] === '' ? this.resourcesPath + 'crds/org_v1_che_cr.yaml' : flags['che-operator-cr-yaml']
            await kube.createCheClusterFromFile(yamlFilePath, flags, flags['che-operator-cr-yaml'] === '')
            task.title = `${task.title}...done.`
          }
        }
      }
    ], { renderer: flags['listr-renderer'] as any })
  }

  /**
   * Returns list of tasks which remove che operator related resources
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    let kh = new KubeHelper(flags)
    return [{
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
      title: 'Delete CRD checlusters.org.eclipse.che',
      task: async (_ctx: any, task: any) => {
        if (await kh.crdExist('checlusters.org.eclipse.che')) {
          await kh.deleteCrd('checlusters.org.eclipse.che')
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
      title: 'Delete cluster role binding che-operator',
      task: async (_ctx: any, task: any) => {
        if (await kh.clusterRoleBindingExist('che-operator')) {
          await kh.deleteClusterRoleBinding('che-operator')
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
      title: 'Delete rolebinding che-operator',
      task: async (_ctx: any, task: any) => {
        if (await kh.roleBindingExist('che', flags.chenamespace)) {
          await kh.deleteRoleBinding('che', flags.chenamespace)
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
      title: 'Delete service accounts che-operator',
      task: async (_ctx: any, task: any) => {
        if (await kh.roleBindingExist('che-operator', flags.chenamespace)) {
          await kh.deleteServiceAccount('che-operator', flags.chenamespace)
        }
        task.title = await `${task.title}...OK`
      }
    },
    {
      title: 'Delete PVC che-operator',
      task: async (_ctx: any, task: any) => {
        if (await kh.persistentVolumeClaimExist('che-operator', flags.chenamespace)) {
          await kh.deletePersistentVolumeClaim('che-operator', flags.chenamespace)
        }
        task.title = await `${task.title}...OK`
      }
    },
    ]
  }

  async copyCheOperatorResources(templatesDir: string, cacheDir: string): Promise<string> {
    const srcDir = path.join(templatesDir, '/che-operator/')
    const destDir = path.join(cacheDir, '/templates/che-operator/')
    await remove(destDir)
    await mkdirp(destDir)
    await ncp(srcDir, destDir, {}, (err: Error) => { if (err) { throw err } })
    return destDir
  }
}
