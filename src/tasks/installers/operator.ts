/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { V1ClusterRole, V1ClusterRoleBinding, V1ConfigMap, V1Deployment, V1Role, V1RoleBinding, V1Service } from '@kubernetes/client-node'
import { Command } from '@oclif/command'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CRD, CHE_OPERATOR_SELECTOR, OPERATOR_DEPLOYMENT_NAME, OPERATOR_TEMPLATE_DIR } from '../../constants'
import { getImageNameAndTag, safeLoadFromYamlFile } from '../../util'
import { KubeTasks } from '../kube'
import { createEclipseCheCluster, patchingEclipseCheCluster } from './common-tasks'
import { V1Certificate } from '../../api/types/cert-manager'

export class OperatorTasks {
  private static readonly MANAGER_CONFIG_MAP = 'manager-config'
  private static readonly WEBHOOK_SERVICE = 'webhook-service'
  private static readonly CERTIFICATE = 'serving-cert'
  private static readonly ISSUER = 'selfsigned-issuer'

  operatorServiceAccount = 'che-operator'

  legacyClusterResourcesName = 'che-operator'

  devworkspaceCheNamePrefix = 'devworkspace-che'

  private getReadRolesAndBindingsTask(kube: KubeHelper): Listr.ListrTask {
    return {
      title: 'Read Roles and Bindings',
      task: async (ctx: any, task: any) => {
        ctx.roles = []
        ctx.roleBindings = []
        ctx.clusterRoles = []
        ctx.clusterRoleBindings = []
        const filesList = fs.readdirSync(ctx[ChectlContext.RESOURCES])
        for (const fileName of filesList) {
          if (!fileName.endsWith('.yaml')) {
            continue
          }
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], fileName)
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

        task.title = `${task.title}...[OK]`
      },
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
          if (await kube.isRoleExist(role.metadata!.name!, flags.chenamespace)) {
            if (shouldUpdate) {
              await kube.replaceRole(role, flags.chenamespace)
            }
          } else {
            await kube.createRole(role, flags.chenamespace)
          }
        }

        for (const roleBinding of ctx.roleBindings as V1RoleBinding[]) {
          if (await kube.isRoleBindingExist(roleBinding.metadata!.name!, flags.chenamespace)) {
            if (shouldUpdate) {
              await kube.replaceRoleBinding(roleBinding, flags.chenamespace)
            }
          } else {
            await kube.createRoleBinding(roleBinding, flags.chenamespace)
          }
        }

        // For Cluster Roles and Cluster Role Bindings use prefix to allow several Che installations
        const clusterObjectNamePrefix = `${flags.chenamespace}-`

        for (const clusterRole of ctx.clusterRoles as V1ClusterRole[]) {
          const clusterRoleName = clusterObjectNamePrefix + clusterRole.metadata!.name
          if (await kube.isClusterRoleExist(clusterRoleName)) {
            if (shouldUpdate) {
              await kube.replaceClusterRoleFromObj(clusterRole, clusterRoleName)
            }
          } else {
            await kube.createClusterRole(clusterRole, clusterRoleName)
          }
        }

        for (const clusterRoleBinding of ctx.clusterRoleBindings as V1ClusterRoleBinding[]) {
          clusterRoleBinding.metadata!.name = clusterObjectNamePrefix + clusterRoleBinding.metadata!.name
          clusterRoleBinding.roleRef.name = clusterObjectNamePrefix + clusterRoleBinding.roleRef.name
          for (const subj of clusterRoleBinding.subjects || []) {
            subj.namespace = flags.chenamespace
          }
          if (await kube.isClusterRoleBindingExist(clusterRoleBinding.metadata!.name)) {
            if (shouldUpdate) {
              await kube.replaceClusterRoleBinding(clusterRoleBinding)
            }
          } else {
            await kube.createClusterRoleBinding(clusterRoleBinding)
          }
        }

        task.title = `${task.title}...[OK]`
      },
    }
  }

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  async deployTasks(flags: any): Promise<Listr.ListrTask[]> {
    const kube = new KubeHelper(flags)
    const kubeTasks = new KubeTasks(flags)

    return [
      {
        title: `Create ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.isServiceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'service_account.yaml')
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      this.getReadRolesAndBindingsTask(kube),
      this.getCreateOrUpdateRolesAndBindingsTask(flags, 'Creating Roles and Bindings', false),
      {
        title: `Create CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await kube.getCrd(CHE_CLUSTER_CRD)
          if (existedCRD) {
            task.title = `${task.title}...[Exists]`
          } else {
            const newCRDPath = await this.getCRDPath(ctx, flags)
            await kube.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: 'Waiting 5 seconds for the new Kubernetes resources to get flushed',
        task: async (_ctx: any, task: any) => {
          await cli.wait(5000)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: `Create ConfigMap ${OperatorTasks.MANAGER_CONFIG_MAP}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.isConfigMapExists(OperatorTasks.MANAGER_CONFIG_MAP, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'manager-config.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const configMap = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1ConfigMap
              await kube.createConfigMap(configMap, flags.chenamespace)
              task.title = `${task.title}...[OK]`
            } else {
              task.title = `${task.title}...[Skipped]`
            }
          }
        },
      },
      {
        title: `Create Webhook Service ${OperatorTasks.MANAGER_CONFIG_MAP}`,
        task: async (ctx: any, task: any) => {
          const exists = await kube.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'webhook-service.yaml')
            if (fs.existsSync(yamlFilePath)) {
              await kube.createServiceFromFile(yamlFilePath, flags.chenamespace)
              task.title = `${task.title}...[OK]`
            } else {
              task.title = `${task.title}...[Skipped]`
            }
          }
        },
      },
      {
        title: `Create deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exists = await kube.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const deploymentPath = path.join(ctx[ChectlContext.RESOURCES], 'operator.yaml')
            const operatorDeployment = await this.readOperatorDeployment(deploymentPath, flags)
            await kube.createDeployment(operatorDeployment, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: `Create Certificate ${OperatorTasks.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const exists = await kube.isCertificateExists(OperatorTasks.CERTIFICATE, flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'serving-cert.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
              await kube.createCertificate(certificate, flags.chenamespace)
              task.title = `${task.title}...[OK]`
            } else {
              task.title = `${task.title}...[Skipped]`
            }
          }
        },
      },
      {
        title: `Create Issuer ${OperatorTasks.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const exists = await kube.isIssuerExists(OperatorTasks.ISSUER, flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'selfsigned-issuer.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
              await kube.createIssuer(issuer, flags.chenamespace)
              task.title = `${task.title}...[OK]`
            } else {
              task.title = `${task.title}...[Skipped]`
            }
          }
        },
      },
      {
        title: 'Operator pod bootstrap',
        task: () => kubeTasks.podStartTasks(CHE_OPERATOR_SELECTOR, flags.chenamespace),
      },
      {
        title: 'Prepare Eclipse Che cluster CR',
        task: async (ctx: any, task: any) => {
          const cheCluster = await kube.getCheClusterV1(flags.chenamespace)
          if (cheCluster) {
            task.title = `${task.title}...[Exists]`
            return
          }

          if (!ctx.customCR) {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'crds', 'org_checluster_cr.yaml')
            ctx.defaultCR = safeLoadFromYamlFile(yamlFilePath)
          }

          task.title = `${task.title}...[OK]`
        },
      },
      createEclipseCheCluster(flags, kube),
    ]
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    const ctx = ChectlContext.get()
    ctx[ChectlContext.RESOURCES] = path.join(flags.templates, OPERATOR_TEMPLATE_DIR)
    return new Listr([
      {
        title: 'Checking existing operator deployment before update',
        task: async (ctx: any, task: any) => {
          const operatorDeployment = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (!operatorDeployment) {
            command.error(`${OPERATOR_DEPLOYMENT_NAME} deployment is not found in namespace ${flags.chenamespace}.\nProbably Eclipse Che was initially deployed with another installer`)
          }
          ctx.deployedCheOperatorYaml = operatorDeployment
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Detecting existing version...',
        task: async (ctx: any, task: any) => {
          ctx.deployedCheOperatorImage = this.retrieveContainerImage(ctx.deployedCheOperatorYaml)
          const [deployedImage, deployedTag] = getImageNameAndTag(ctx.deployedCheOperatorImage)
          ctx.deployedCheOperatorImageName = deployedImage
          ctx.deployedCheOperatorImageTag = deployedTag

          if (flags['che-operator-image']) {
            ctx.newCheOperatorImage = flags['che-operator-image']
          } else {
            // Load new operator image from templates
            const newCheOperatorYaml = safeLoadFromYamlFile(path.join(flags.templates, OPERATOR_TEMPLATE_DIR, 'operator.yaml')) as V1Deployment
            ctx.newCheOperatorImage = this.retrieveContainerImage(newCheOperatorYaml)
          }
          const [newImage, newTag] = getImageNameAndTag(ctx.newCheOperatorImage)
          ctx.newCheOperatorImageName = newImage
          ctx.newCheOperatorImageTag = newTag

          task.title = `${task.title} ${ctx.deployedCheOperatorImageTag} -> ${ctx.newCheOperatorImageTag}`
        },
      },
      {
        title: 'Check workspace engine compatibility...',
        task: async (_ctx: any, _task: any) => {
          const cheCluster = await kube.getCheClusterV1(flags.chenamespace)
          const isDevWorkspaceEngineDisabledBeforeUpdate = !cheCluster?.spec?.devWorkspace?.enable
          if (isDevWorkspaceEngineDisabledBeforeUpdate) {
            command.error('Unsupported operation: it is not possible to update current Che installation to new version with enabled \'devWorkspace\' engine.')
          }
        },
      },
    ])
  }

  updateTasks(flags: any, command: Command): Array<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    const ctx = ChectlContext.get()
    ctx[ChectlContext.RESOURCES] = path.join(flags.templates, OPERATOR_TEMPLATE_DIR)
    return [
      {
        title: `Updating ServiceAccount ${this.operatorServiceAccount} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.isServiceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'service_account.yaml')
          if (exist) {
            await kube.replaceServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createServiceAccountFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        },
      },
      this.getReadRolesAndBindingsTask(kube),
      this.getCreateOrUpdateRolesAndBindingsTask(flags, 'Updating Roles and Bindings', true),
      {
        title: `Updating Eclipse Che cluster CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await kube.getCrd(CHE_CLUSTER_CRD)
          const newCRDPath = await this.getCRDPath(ctx, flags)

          if (existedCRD) {
            if (!existedCRD.metadata || !existedCRD.metadata.resourceVersion) {
              throw new Error(`Fetched CRD ${CHE_CLUSTER_CRD} without resource version`)
            }

            await kube.replaceCrdFromFile(newCRDPath)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...created new one.`
          }
        },
      },
      {
        title: 'Waiting 5 seconds for the new Kubernetes resources to get flushed',
        task: async (_ctx: any, task: any) => {
          await cli.wait(5000)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: `Update ConfigMap ${OperatorTasks.MANAGER_CONFIG_MAP}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'manager-config.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped]`
            return
          }

          const configMap = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1ConfigMap
          const exist = await kube.isConfigMapExists(OperatorTasks.MANAGER_CONFIG_MAP, flags.chenamespace)
          if (exist) {
            await kube.replaceConfigMap(OperatorTasks.MANAGER_CONFIG_MAP, configMap, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          } else {
            await kube.createConfigMap(configMap, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: `Update Webhook Service ${OperatorTasks.WEBHOOK_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'webhook-service.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped]`
            return
          }

          const service = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Service
          const exist = await kube.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, flags.chenamespace)
          if (exist) {
            await kube.replaceService(OperatorTasks.WEBHOOK_SERVICE, service, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          } else {
            await kube.createService(service, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: `Updating deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await kube.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          const deploymentPath = path.join(ctx[ChectlContext.RESOURCES], 'operator.yaml')
          const operatorDeployment = await this.readOperatorDeployment(deploymentPath, flags)
          if (exist) {
            await kube.replaceDeployment(operatorDeployment)
            task.title = `${task.title}...updated.`
          } else {
            await kube.createDeployment(operatorDeployment, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        },
      },
      {
        title: `Update Certificate ${OperatorTasks.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'serving-cert.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped]`
            return
          }

          const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
          const exist = await kube.isCertificateExists(OperatorTasks.CERTIFICATE, flags.chenamespace)
          if (exist) {
            await kube.replaceCertificate(OperatorTasks.WEBHOOK_SERVICE, certificate, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          } else {
            await kube.createCertificate(certificate, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: `Update Issuer ${OperatorTasks.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'selfsigned-issuer.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped]`
            return
          }

          const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
          const exist = await kube.isIssuerExists(OperatorTasks.ISSUER, flags.chenamespace)
          if (exist) {
            await kube.replaceIssuer(OperatorTasks.WEBHOOK_SERVICE, issuer, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          } else {
            await kube.createIssuer(issuer, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: 'Waiting newer operator to be run',
        task: async (_ctx: any, _task: any) => {
          await cli.wait(1000)
          await kube.waitLatestReplica(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
        },
      },
      patchingEclipseCheCluster(flags, kube, command),
    ]
  }

  /**
   * Returns list of tasks which remove Eclipse Che operator related resources
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kh = new KubeHelper(flags)
    return [{
      title: 'Delete oauthClientAuthorizations',
      task: async (_ctx: any, task: any) => {
        const checluster = await kh.getCheClusterV1(flags.chenamespace)
        if (checluster?.spec?.auth?.oAuthClientName) {
          await kh.deleteOAuthClient(checluster?.spec?.auth?.oAuthClientName)
        }
        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete Webhook Service ${OperatorTasks.WEBHOOK_SERVICE}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteService(OperatorTasks.WEBHOOK_SERVICE, flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete ConfigMap ${OperatorTasks.MANAGER_CONFIG_MAP}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteConfigMap(OperatorTasks.MANAGER_CONFIG_MAP, flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete Issuer ${OperatorTasks.ISSUER}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteIssuer(OperatorTasks.ISSUER, flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete Certificate ${OperatorTasks.CERTIFICATE}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteCertificate(OperatorTasks.CERTIFICATE, flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete the Custom Resource of type ${CHE_CLUSTER_CRD}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteAllCheClusters(flags.chenamespace)

        // wait 20 seconds, default timeout in che operator
        for (let index = 0; index < 20; index++) {
          await cli.wait(1000)
          if (!await kh.getCheClusterV1(flags.chenamespace)) {
            task.title = `${task.title}...OK`
            return
          }
        }

        // if checluster still exists then remove finalizers and delete again
        const checluster = await kh.getCheClusterV1(flags.chenamespace)
        if (checluster) {
          try {
            await kh.patchCheCluster(checluster.metadata.name, flags.chenamespace, {metadata: { finalizers: null } })
          } catch (error) {
            if (!await kh.getCheClusterV1(flags.chenamespace)) {
              task.title = `${task.title}...OK`
              return // successfully removed
            }
            throw error
          }

          // wait 2 seconds
          await cli.wait(2000)
        }

        if (!await kh.getCheClusterV1(flags.chenamespace)) {
          task.title = `${task.title}...OK`
        } else {
          task.title = `${task.title}...Failed`
        }
      },
    },
    {
      title: 'Delete CRDs',
      task: async (_ctx: any, task: any) => {
        const checlusters = await kh.getAllCheClusters()
        if (checlusters.length > 0) {
          task.title = `${task.title}...Skipped: another Eclipse Che deployment found.`
        } else {
          await kh.deleteCrd(CHE_CLUSTER_CRD)
          task.title = `${task.title}...OK`
        }
      },
    },
    {
      title: 'Delete Roles and Bindings',
      task: async (_ctx: any, task: any) => {
        const roleBindings = await kh.listRoleBindings(flags.chenamespace)
        for (const roleBinding of roleBindings.items) {
          await kh.deleteRoleBinding(roleBinding.metadata!.name!, flags.chenamespace)
        }

        const roles = await kh.listRoles(flags.chenamespace)
        for (const role of roles.items) {
          await kh.deleteRole(role.metadata!.name!, flags.chenamespace)
        }

        // Count existing pairs of cluster roles and thier bindings
        let pairs = 0

        const clusterRoleBindings = await kh.listClusterRoleBindings()
        for (const clusterRoleBinding of clusterRoleBindings.items) {
          const name = clusterRoleBinding.metadata && clusterRoleBinding.metadata.name || ''
          if (name.startsWith(flags.chenamespace) || name.startsWith(this.devworkspaceCheNamePrefix)) {
            pairs++
            await kh.deleteClusterRoleBinding(name)
          }
        }

        const clusterRoles = await kh.listClusterRoles()
        for (const clusterRole of clusterRoles.items) {
          const name = clusterRole.metadata && clusterRole.metadata.name || ''
          if (name.startsWith(flags.chenamespace) || name.startsWith(this.devworkspaceCheNamePrefix)) {
            await kh.deleteClusterRole(name)
          }
        }

        // If no pairs were deleted, then legacy names is used
        if (pairs === 0) {
          await kh.deleteClusterRoleBinding(this.legacyClusterResourcesName)
          await kh.deleteClusterRole(this.legacyClusterResourcesName)
        }

        task.title = `${task.title}...OK`
      },
    },
    {
      title: `Delete service accounts ${this.operatorServiceAccount}`,
      task: async (_ctx: any, task: any) => {
        await kh.deleteServiceAccount(this.operatorServiceAccount, flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    },
    {
      title: 'Delete PVC che-operator',
      task: async (_ctx: any, task: any) => {
        await kh.deletePersistentVolumeClaim('che-operator', flags.chenamespace)
        task.title = `${task.title}...OK`
      },
    }]
  }

  retrieveContainerImage(deployment: V1Deployment) {
    const containers = deployment.spec!.template!.spec!.containers
    const namespace = deployment.metadata!.namespace
    const name = deployment.metadata!.name
    const container = containers.find(c => c.name === 'che-operator')

    if (!container) {
      throw new Error(`Can not evaluate image of ${namespace}/${name} deployment. Containers list are empty`)
    }
    if (!container.image) {
      throw new Error(`Container ${container.name} in deployment ${namespace}/${name} must have image specified`)
    }

    return container.image
  }

  /**
   * Returns CheCluster CRD file path depending on its version.
   */
  async getCRDPath(ctx: any, _flags: any): Promise<string> {
    // Legacy CRD CheCluster API v1
    const crdPath = path.join(ctx[ChectlContext.RESOURCES], 'crds', 'org_v1_che_crd.yaml')
    if (fs.existsSync(crdPath)) {
      return crdPath
    }

    // CheCluster API v2
    return path.join(ctx[ChectlContext.RESOURCES], 'crds', 'org.eclipse.che_checlusters.yaml')
  }

  /**
   * Reads and patch 'che-operator' deployment:
   * - sets operator image
   * - sets deployment namespace
   * - removes other containers for ocp 3.11
   */
  private async readOperatorDeployment(path: string, flags: any): Promise<V1Deployment> {
    const operatorDeployment = safeLoadFromYamlFile(path) as V1Deployment

    if (!operatorDeployment.metadata || !operatorDeployment.metadata!.name) {
      throw new Error(`Deployment read from ${path} must have name specified`)
    }

    if (flags['che-operator-image']) {
      const container = operatorDeployment.spec!.template.spec!.containers.find(c => c.name === 'che-operator')
      if (container) {
        container.image = flags['che-operator-image']
      } else {
        throw new Error(`Container 'che-operator' not found in deployment '${operatorDeployment.metadata!.name}'`)
      }
    }

    if (flags.chenamespace) {
      operatorDeployment.metadata!.namespace = flags.chenamespace
    }

    const kube = new KubeHelper(flags)
    if (!await kube.IsAPIExtensionSupported('v1')) {
      const containers = operatorDeployment.spec!.template.spec!.containers || []
      operatorDeployment.spec!.template.spec!.containers = containers.filter(c => c.name === 'che-operator')
    }

    return operatorDeployment
  }
}
