/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { V1ClusterRole, V1ClusterRoleBinding, V1Deployment, V1Role, V1RoleBinding } from '@kubernetes/client-node'
import { Command } from '@oclif/command'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as path from 'path'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CRD, CHE_OPERATOR_SELECTOR, OPERATOR_DEPLOYMENT_NAME } from '../../constants'
import { isStableVersion, safeLoadFromYamlFile } from '../../util'
import { KubeTasks } from '../kube'

import { createEclipseCheCluster, createNamespaceTask, patchingEclipseCheCluster } from './common-tasks'

export class OperatorTasks {
  operatorServiceAccount = 'che-operator'
  cheClusterCrd = 'checlusters.org.eclipse.che'
  legacyClusterResourcesName = 'che-operator'

  private getReadRolesAndBindingsTask(kube: KubeHelper): Listr.ListrTask {
    return {
      title: 'Read Roles and Bindings',
      task: async (ctx: any, task: any) => {
        ctx.roles = []
        ctx.roleBindings = []
        ctx.clusterRoles = []
        ctx.clusterRoleBindings = []
        const filesList = fs.readdirSync(ctx.resourcesPath)
        for (const fileName of filesList) {
          if (!fileName.endsWith('.yaml')) {
            continue
          }
          const yamlFilePath = path.join(ctx.resourcesPath, fileName)
          const yamlContent = kube.safeLoadFromYamlFile(yamlFilePath)
          if (!(yamlContent && yamlContent.kind)) {
            continue
          }
          switch (yamlContent.kind) {
          case 'Role':
            ctx.roles.push(yamlContent)
            break
          case 'RoleBinding':
            ctx.roleBindings.push(yamlContent)
            break
          case 'ClusterRole':
            ctx.clusterRoles.push(yamlContent)
            break
          case 'ClusterRoleBinding':
            ctx.clusterRoleBindings.push(yamlContent)
            break
          default:
            // Ignore this object kind
          }
        }

        // Check consistancy
        if (ctx.roles.length !== ctx.roleBindings.length) {
          cli.warn('Number of Roles and Role Bindings is different')
        }
        if (ctx.clusterRoles.length !== ctx.clusterRoleBindings.length) {
          cli.warn('Number of Cluster Roles and Cluster Role Bindings is different')
        }

        task.title = `${task.title}...done.`
      }
    }
  }

  private getCreateOrUpdateRolesAndBindingsTask(flags: any, taskTitle: string, shouldUpdate = false): Listr.ListrTask {
    const kube = new KubeHelper(flags)
    return {
      title: taskTitle,
      task: async (ctx: any, task: any) => {
        if (!ctx.roles) {
          // Should never happen. 'Read Roles and Bindings' task should be called first.
          throw new Error('Should read Roles and Bindings first')
        }

        for (const role of ctx.roles as V1Role[]) {
          if (await kube.roleExist(role.metadata!.name, flags.chenamespace)) {
            if (shouldUpdate) {
              await kube.replaceRoleFrom(role, flags.chenamespace)
            }
          } else {
            await kube.createRoleFrom(role, flags.chenamespace)
          }
        }

        for (const roleBinding of ctx.roleBindings as V1RoleBinding[]) {
          if (await kube.roleBindingExist(roleBinding.metadata!.name, flags.chenamespace)) {
            if (shouldUpdate) {
              await kube.replaceRoleBindingFrom(roleBinding, flags.chenamespace)
            }
          } else {
            await kube.createRoleBindingFrom(roleBinding, flags.chenamespace)
          }
        }

        // For Cluster Roles and Cluster Role Bindings use prefix to allow several Che installations
        const clusterObjectNamePrefix = `${flags.chenamespace}-`

        for (const clusterRole of ctx.clusterRoles as V1ClusterRole[]) {
          const clusterRoleName = clusterObjectNamePrefix + clusterRole.metadata!.name
          if (await kube.clusterRoleExist(clusterRoleName)) {
            if (shouldUpdate) {
              await kube.replaceClusterRoleFrom(clusterRole, clusterRoleName)
            }
          } else {
            await kube.createClusterRoleFrom(clusterRole, clusterRoleName)
          }
        }

        for (const clusterRoleBinding of ctx.clusterRoleBindings as V1ClusterRoleBinding[]) {
          clusterRoleBinding.metadata!.name = clusterObjectNamePrefix + clusterRoleBinding.metadata!.name
          clusterRoleBinding.roleRef.name = clusterObjectNamePrefix + clusterRoleBinding.roleRef.name
          for (const subj of clusterRoleBinding.subjects || []) {
            subj.namespace = flags.chenamespace
          }
          if (await kube.clusterRoleBindingExist(clusterRoleBinding.metadata!.name)) {
            if (shouldUpdate) {
              await kube.replaceClusterRoleBindingFrom(clusterRoleBinding)
            }
          } else {
            await kube.createClusterRoleBindingFrom(clusterRoleBinding)
          }
        }

        task.title = `${task.title}...done.`
      }
    }
  }

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  deployTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    const kubeTasks = new KubeTasks(flags)
    const ctx = ChectlContext.get()
    ctx.resourcesPath = path.join(flags.templates, 'che-operator')
    if (isStableVersion(flags)) {
      command.warn('Consider using the more reliable \'OLM\' installer when deploying a stable release of Eclipse Che (--installer=olm).')
    }
    return new Listr([
      createNamespaceTask(flags.chenamespace, {}),
      {
        title: `Create ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const yamlFilePath = path.join(ctx.resourcesPath, 'service_account.yaml')
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      this.getReadRolesAndBindingsTask(kube),
      this.getCreateOrUpdateRolesAndBindingsTask(flags, 'Creating Roles and Bindings', false),
      {
        title: `Create CRD ${this.cheClusterCrd}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.crdExist(this.cheClusterCrd)
          const yamlFilePath = path.join(ctx.resourcesPath, 'crds', 'org_v1_che_crd.yaml')

          if (exist) {
            const checkCRD = await kube.isCRDCompatible(this.cheClusterCrd, yamlFilePath)
            if (!checkCRD) {
              cli.error(`It is not possible to proceed the installation of Eclipse Che. The existed ${this.cheClusterCrd} is different from a new one. Please update it to continue the installation.`)
            }
            task.title = `${task.title}...It already exists.`
          } else {
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
        title: `Create deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.deploymentExist(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createDeploymentFromFile(path.join(ctx.resourcesPath, 'operator.yaml'), flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Operator pod bootstrap',
        task: () => kubeTasks.podStartTasks(CHE_OPERATOR_SELECTOR, flags.chenamespace)
      },
      {
        title: 'Prepare Eclipse Che cluster CR',
        task: async (ctx: any, task: any) => {
          const cheCluster = await kube.getCheCluster(flags.chenamespace)
          if (cheCluster) {
            task.title = `${task.title}...It already exists..`
            return
          }

          if (!ctx.customCR) {
            const yamlFilePath = path.join(ctx.resourcesPath, 'crds', 'org_v1_che_cr.yaml')
            ctx.defaultCR = safeLoadFromYamlFile(yamlFilePath)
          }

          task.title = `${task.title}...Done.`
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
          const operatorDeployment = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (!operatorDeployment) {
            command.error(`${OPERATOR_DEPLOYMENT_NAME} deployment is not found in namespace ${flags.chenamespace}.\nProbably Eclipse Che was initially deployed with another installer`)
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
      {
        title: `Updating ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          const yamlFilePath = path.join(ctx.resourcesPath, 'service_account.yaml')
          if (exist) {
            await kube.replaceServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      this.getReadRolesAndBindingsTask(kube),
      this.getCreateOrUpdateRolesAndBindingsTask(flags, 'Updating Roles and Bindings', false),
      {
        title: `Updating Eclipse Che cluster CRD ${this.cheClusterCrd}`,
        task: async (ctx: any, task: any) => {
          const crd = await kube.getCrd(this.cheClusterCrd)
          const yamlFilePath = path.join(ctx.resourcesPath, 'crds', 'org_v1_che_crd.yaml')
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
        title: `Updating deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.deploymentExist(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          const deploymentPath = path.join(ctx.resourcesPath, 'operator.yaml')
          if (exist) {
            await kube.replaceDeploymentFromFile(deploymentPath, flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...updated.`
          } else {
            await kube.createDeploymentFromFile(deploymentPath, flags.chenamespace, flags['che-operator-image'])
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Waiting newer operator to be run',
        task: async (_ctx: any, _task: any) => {
          await cli.wait(1000)
          await kube.waitLatestReplica(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
        }
      },
      patchingEclipseCheCluster(flags, kube, command),
    ], { renderer: flags['listr-renderer'] as any })
  }

  /**
   * Returns list of tasks which remove Eclipse Che operator related resources
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    let kh = new KubeHelper(flags)
    return [{
      title: 'Delete oauthClientAuthorizations',
      task: async (_ctx: any, task: any) => {
        const checluster = await kh.getCheCluster(flags.chenamespace)
        if (checluster && checluster.spec && checluster.spec.auth && checluster.spec.auth.oAuthClientName) {
          const oAuthClientAuthorizations = await kh.getOAuthClientAuthorizations(checluster.spec.auth.oAuthClientName)
          await kh.deleteOAuthClientAuthorizations(oAuthClientAuthorizations)
        }
        task.title = `${task.title}...OK`
      }
    },
    {
      title: `Delete the Custom Resource of type ${CHE_CLUSTER_CRD}`,
      task: async (_ctx: any, task: any) => {
        const checluster = await kh.getCheCluster(flags.chenamespace)
        if (checluster) {
          await kh.patchCheClusterCustomResource(checluster.metadata.name, flags.chenamespace, { metadata: { finalizers: null } })
        }

        await kh.deleteCheCluster(flags.chenamespace)
        do {
          await cli.wait(2000) //wait a couple of secs for the finalizers to be executed
        } while (await kh.getCheCluster(flags.chenamespace))
        task.title = `${task.title}...OK`
      }
    },
    {
      title: `Delete CRD ${this.cheClusterCrd}`,
      task: async (_ctx: any, task: any) => {
        const crdExists = await kh.crdExist(this.cheClusterCrd)
        const checlusters = await kh.getAllCheClusters()
        if (checlusters.length > 0) {
          task.title = `${task.title}...Skipped: another Eclipse Che deployment found.`
        } else {
          // Check if CRD exist. When installer is helm the CRD are not created
          if (crdExists) {
            await kh.deleteCrd(this.cheClusterCrd)
          }
          task.title = `${task.title}...OK`
        }
      }
    },
    {
      title: 'Delete Roles and Bindings',
      task: async (_ctx: any, task: any) => {
        const roleBindings = await kh.listRoleBindings(flags.chenamespace)
        for (const roleBinding of roleBindings.items) {
          await kh.deleteRoleBinding(roleBinding.metadata!.name, flags.chenamespace)
        }

        const roles = await kh.listRoles(flags.chenamespace)
        for (const role of roles.items) {
          await kh.deleteRole(role.metadata!.name, flags.chenamespace)
        }

        // Count existing pairs of cluster roles and thier bindings
        let pairs = 0

        const clusterRoleBindings = await kh.listClusterRoleBindings()
        for (const clusterRoleBinding of clusterRoleBindings.items) {
          const name = clusterRoleBinding.metadata && clusterRoleBinding.metadata.name || ''
          if (name.startsWith(flags.chenamespace)) {
            pairs++
            await kh.deleteClusterRoleBinding(name)
          }
        }

        const clusterRoles = await kh.listClusterRoles()
        for (const clusterRole of clusterRoles.items) {
          const name = clusterRole.metadata && clusterRole.metadata.name || ''
          if (name.startsWith(flags.chenamespace)) {
            await kh.deleteClusterRole(name)
          }
        }

        // If no pairs were deleted, then legacy names is used
        if (pairs === 0) {
          if (await kh.clusterRoleBindingExist(this.legacyClusterResourcesName)) {
            await kh.deleteClusterRoleBinding(this.legacyClusterResourcesName)
          }
          if (await kh.clusterRoleExist(this.legacyClusterResourcesName)) {
            await kh.deleteClusterRole(this.legacyClusterResourcesName)
          }
        }

        task.title = `${task.title}...OK`
      }
    },
    {
      title: `Delete service accounts ${this.operatorServiceAccount}`,
      task: async (_ctx: any, task: any) => {
        if (await kh.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)) {
          await kh.deleteServiceAccount(this.operatorServiceAccount, flags.chenamespace)
        }
        task.title = `${task.title}...OK`
      }
    },
    {
      title: 'Delete PVC che-operator',
      task: async (_ctx: any, task: any) => {
        if (await kh.persistentVolumeClaimExist('che-operator', flags.chenamespace)) {
          await kh.deletePersistentVolumeClaim('che-operator', flags.chenamespace)
        }
        task.title = `${task.title}...OK`
      }
    },
    ]
  }

  async evaluateTemplateOperatorImage(flags: any): Promise<string> {
    if (flags['che-operator-image']) {
      return flags['che-operator-image']
    } else {
      const filePath = path.join(flags.templates, 'che-operator', 'operator.yaml')
      const yamlDeployment = safeLoadFromYamlFile(filePath) as V1Deployment
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
