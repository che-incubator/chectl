/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { V1Deployment } from '@kubernetes/client-node'
import { Command } from '@oclif/command'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CR_NAME } from '../../constants'

import { checkTlsCertificate, copyOperatorResources, createEclipseCheCluster, createNamespaceTask } from './common-tasks'

export class OperatorTasks {
  operatorServiceAccount = 'che-operator'
  operatorRole = 'che-operator'
  operatorClusterRole = 'che-operator'
  operatorRoleBinding = 'che-operator'
  operatorClusterRoleBinding = 'che-operator'
  cheClusterCrd = 'checlusters.org.eclipse.che'
  operatorName = 'che-operator'

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    command.warn('You can also use features rich \'OLM\' installer to deploy Eclipse Che.')
    return new Listr([
      copyOperatorResources(flags, command.config.cacheDir),
      createNamespaceTask(flags),
      checkTlsCertificate(flags),
      {
        title: `Create ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = ctx.resourcesPath + 'service_account.yaml'
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create Role ${this.operatorRole} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.roleExist(this.operatorRole, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = ctx.resourcesPath + 'role.yaml'
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
        task: async (ctx: any, task: any) => {
          const exist = await kube.clusterRoleExist(this.operatorClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = ctx.resourcesPath + 'cluster_role.yaml'
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
        task: async (ctx: any, task: any) => {
          const exist = await kube.roleBindingExist(this.operatorRoleBinding, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = ctx.resourcesPath + 'role_binding.yaml'
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
        title: `Create CRD ${this.cheClusterCrd}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.crdExist(this.cheClusterCrd)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = ctx.resourcesPath + 'crds/org_v1_che_crd.yaml'
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
        task: async (ctx: any, task: any) => {
          const exist = await kube.deploymentExist(this.operatorName, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createDeploymentFromFile(ctx.resourcesPath + 'operator.yaml', flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...done.`
          }
        }
      },
      createEclipseCheCluster(flags, kube)
    ], { renderer: flags['listr-renderer'] as any })
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Checking versions compatibility before updating',
        task: async (ctx: any, _task: any) => {
          const operatorDeployment = await kube.getDeployment(this.operatorName, flags.chenamespace)
          if (!operatorDeployment) {
            command.error(`${this.operatorName} deployment is not found in namespace ${flags.chenamespace}.\nProbably Eclipse Che was initially deployed with another installer`)
            return
          }
          const deployedCheOperator = this.retrieveContainerImage(operatorDeployment)
          const deployedCheOperatorImageAndTag = deployedCheOperator.split(':', 2)
          ctx.deployedCheOperatorImage = deployedCheOperatorImageAndTag[0]
          ctx.deployedCheOperatorTag = deployedCheOperatorImageAndTag.length === 2 ? deployedCheOperatorImageAndTag[1] : 'latest'

          const newCheOperatorImageAndTag = flags['che-operator-image'].split(':', 2)
          ctx.newCheOperatorImage = newCheOperatorImageAndTag[0]
          ctx.newCheOperatorTag = newCheOperatorImageAndTag.length === 2 ? newCheOperatorImageAndTag[1] : 'latest'
        }
      }])
  }

  updateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      copyOperatorResources(flags, command.config.cacheDir),
      {
        title: `Updating ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          const yamlFilePath = ctx.resourcesPath + 'service_account.yaml'
          if (exist) {
            await kube.replaceServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: `Updating Role ${this.operatorRole} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.roleExist(this.operatorRole, flags.chenamespace)
          const yamlFilePath = ctx.resourcesPath + 'role.yaml'
          if (exist) {
            const statusCode = await kube.replaceRoleFromFile(yamlFilePath, flags.chenamespace)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...updated.`
          } else {
            const statusCode = await kube.createRoleFromFile(yamlFilePath, flags.chenamespace)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: `Updating ClusterRole ${this.operatorClusterRole}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.clusterRoleExist(this.operatorClusterRole)
          const yamlFilePath = ctx.resourcesPath + 'cluster_role.yaml'
          if (exist) {
            const statusCode = await kube.replaceClusterRoleFromFile(yamlFilePath)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...updated.`
          } else {
            const statusCode = await kube.createClusterRoleFromFile(yamlFilePath)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...created a new one.`
          }
        }
      },
      {
        title: `Updating RoleBinding ${this.operatorRoleBinding} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.roleBindingExist(this.operatorRoleBinding, flags.chenamespace)
          const yamlFilePath = ctx.resourcesPath + 'role_binding.yaml'
          if (exist) {
            await kube.replaceRoleBindingFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createRoleBindingFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: `Updating ClusterRoleBinding ${this.operatorClusterRoleBinding}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.clusterRoleBindingExist(this.operatorRoleBinding)
          if (exist) {
            await kube.replaceClusterRoleBinding(this.operatorClusterRoleBinding, this.operatorServiceAccount, flags.chenamespace, this.operatorClusterRole)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createClusterRoleBinding(this.operatorClusterRoleBinding, this.operatorServiceAccount, flags.chenamespace, this.operatorClusterRole)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: `Updating Eclipse Che cluster CRD ${this.cheClusterCrd}`,
        task: async (ctx: any, task: any) => {
          const crd = await kube.getCrd(this.cheClusterCrd)
          const yamlFilePath = ctx.resourcesPath + 'crds/org_v1_che_crd.yaml'
          if (crd) {
            if (!crd.metadata || !crd.metadata.resourceVersion) {
              throw new Error(`Fetched CRD ${this.cheClusterCrd} without resource version`)
            }

            await kube.replaceCrdFromFile(yamlFilePath, crd.metadata.resourceVersion)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createCrdFromFile(yamlFilePath)
            task.title = `${task.title}...created new one.`
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
        title: `Updating deployment ${this.operatorName} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.deploymentExist(this.operatorName, flags.chenamespace)
          if (exist) {
            await kube.replaceDeploymentFromFile(ctx.resourcesPath + 'operator.yaml', flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...updated.`
          } else {
            await kube.createDeploymentFromFile(ctx.resourcesPath + 'operator.yaml', flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Waiting newer operator to be run',
        task: async (_ctx: any, _task: any) => {
          await cli.wait(1000)
          await kube.waitLatestReplica(this.operatorName, flags.chenamespace)
        }
      }
    ], { renderer: flags['listr-renderer'] as any })
  }

  /**
   * Returns list of tasks which remove Eclipse Che operator related resources
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    let kh = new KubeHelper(flags)
    return [{
      title: `Delete the CR ${CHE_CLUSTER_CR_NAME} of type ${this.cheClusterCrd}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.crdExist(this.cheClusterCrd) &&
          await kh.getCheCluster(CHE_CLUSTER_CR_NAME, flags.chenamespace)) {
          await kh.deleteCheCluster(CHE_CLUSTER_CR_NAME, flags.chenamespace)
          await cli.wait(2000) //wait a couple of secs for the finalizers to be executed
          task.title = await `${task.title}...OK`
        } else {
          task.title = await `${task.title}...CR not found`
        }
      }
    },
    {
      title: `Delete role binding ${this.operatorRoleBinding}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.roleBindingExist(this.operatorRoleBinding, flags.chenamespace)) {
          await kh.deleteRoleBinding(this.operatorRoleBinding, flags.chenamespace)
        }
        task.title = await `${task.title}...OK`
      }
    },
    {
      title: `Delete role ${this.operatorRole}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.roleExist(this.operatorRole, flags.chenamespace)) {
          await kh.deleteRole(this.operatorRole, flags.chenamespace)
        }
        task.title = await `${task.title}...OK`
      }
    },
    {
      title: `Delete cluster role binding ${this.operatorClusterRoleBinding}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.clusterRoleBindingExist(this.operatorClusterRoleBinding)) {
          await kh.deleteClusterRoleBinding(this.operatorClusterRoleBinding)
        }
        task.title = await `${task.title}...OK`
      }
    },
    {
      title: `Delete cluster role ${this.operatorClusterRole}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.clusterRoleExist(this.operatorClusterRole)) {
          await kh.deleteClusterRole(this.operatorClusterRole)
        }
        task.title = await `${task.title}...OK`
      }
    },
    {
      title: 'Delete server and workspace rolebindings',
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
      title: `Delete service accounts ${this.operatorServiceAccount}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)) {
          await kh.deleteServiceAccount(this.operatorServiceAccount, flags.chenamespace)
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

  async evaluateTemplateOperatorImage(flags: any): Promise<string> {
    if (flags['che-operator-image']) {
      return flags['che-operator-image']
    } else {
      const filePath = flags.templates + '/che-operator/operator.yaml'
      const yamlFile = fs.readFileSync(filePath)
      const yamlDeployment = yaml.safeLoad(yamlFile.toString()) as V1Deployment
      return yamlDeployment.spec!.template.spec!.containers[0].image!
    }
  }

  retrieveContainerImage(deployment: V1Deployment) {
    const containers = deployment.spec!.template!.spec!.containers

    const namespace = deployment.metadata!.namespace
    const name = deployment.metadata!.name
    if (containers.length === 0) {
      throw new Error(`Can not evaluate image of ${namespace}/${name} deployment. Containers list are empty`)
    }

    if (containers.length > 1) {
      throw new Error(`Can not evaluate image of ${namespace}/${name} deployment. It has multiple containers`)
    }

    const container = containers[0]
    if (!container.image) {
      throw new Error(`Container ${container.name} in deployment ${namespace}/${name} must have image specified`)
    }

    return container.image
  }
}
