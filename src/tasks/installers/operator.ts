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
import { createEclipseCheClusterTask, patchingEclipseCheCluster } from './common-tasks'
import { V1Certificate } from '../../api/types/cert-manager'

export class OperatorTasks {
  private static readonly MANAGER_CONFIG_MAP = 'manager-config'
  private static readonly WEBHOOK_SERVICE = 'webhook-service'
  private static readonly CERTIFICATE = 'serving-cert'
  private static readonly ISSUER = 'selfsigned-issuer'
  private static readonly SERVICE_ACCOUNT = 'che-operator'
  private static readonly DEVWORKSPACE_PREFIX = 'devworkspace-che'

  protected kh: KubeHelper

  constructor(protected readonly flags: any) {
    this.kh = new KubeHelper(flags)
  }

  private getCreateOrUpdateRolesAndBindingsTasks(updateTask = false): Listr.ListrTask {
    return {
      title: 'Role and RoleBindings',
      task: async (ctx: any, task: any) => {
        const resources = this.collectReadRolesAndBindings(ctx)
        const rolesTasks = new Listr(undefined, ctx.listrOptions)

        for (const role of resources.roles as V1Role[]) {
          rolesTasks.add(
            {
              title: `${updateTask ? 'Update' : 'Create'} Role ${role.metadata!.name}`,
              task: async (_ctx: any, task: any) => {
                if (await this.kh.isRoleExist(role.metadata!.name!, this.flags.chenamespace)) {
                  if (updateTask) {
                    await this.kh.replaceRole(role, this.flags.chenamespace)
                    task.title = `${task.title}...[Updated]`
                  } else {
                    task.title = `${task.title}...[Skipped: Exists]`
                  }
                } else {
                  await this.kh.createRole(role, this.flags.chenamespace)
                  task.title = `${task.title}...[Created]`
                }
              },
            }
          )
        }

        for (const roleBinding of resources.roleBindings as V1RoleBinding[]) {
          rolesTasks.add(
            {
              title: `${updateTask ? 'Update' : 'Create'} RoleBinding ${roleBinding.metadata!.name}`,
              task: async (_ctx: any, task: any) => {
                if (await this.kh.isRoleBindingExist(roleBinding.metadata!.name!, this.flags.chenamespace)) {
                  if (updateTask) {
                    await this.kh.replaceRoleBinding(roleBinding, this.flags.chenamespace)
                    task.title = `${task.title}...[Updated]`
                  } else {
                    task.title = `${task.title}...[Skipped: Exists]`
                  }
                } else {
                  await this.kh.createRoleBinding(roleBinding, this.flags.chenamespace)
                  task.title = `${task.title}...[Created]`
                }
              },
            }
          )
        }

        // For Cluster Roles and Cluster Role Bindings use prefix to allow several Che installations
        const clusterObjectNamePrefix = `${this.flags.chenamespace}-`

        for (const clusterRole of resources.clusterRoles as V1ClusterRole[]) {
          rolesTasks.add(
            {
              title: `${updateTask ? 'Update' : 'Create'} ClusterRole ${clusterRole.metadata!.name}`,
              task: async (_ctx: any, task: any) => {
                const clusterRoleName = clusterObjectNamePrefix + clusterRole.metadata!.name
                if (await this.kh.isClusterRoleExist(clusterRoleName)) {
                  if (updateTask) {
                    await this.kh.replaceClusterRoleFromObj(clusterRole, clusterRoleName)
                    task.title = `${task.title}...[Updated]`
                  } else {
                    task.title = `${task.title}...[Skipped: Exists]`
                  }
                } else {
                  await this.kh.createClusterRole(clusterRole, clusterRoleName)
                  task.title = `${task.title}...[Created]`
                }
              },
            }
          )
        }

        for (const clusterRoleBinding of resources.clusterRoleBindings as V1ClusterRoleBinding[]) {
          rolesTasks.add(
            {
              title: `${updateTask ? 'Update' : 'Create'} ClusterRoleBinding ${clusterRoleBinding.metadata!.name}`,
              task: async (_ctx: any, task: any) => {
                clusterRoleBinding.metadata!.name = clusterObjectNamePrefix + clusterRoleBinding.metadata!.name
                clusterRoleBinding.roleRef.name = clusterObjectNamePrefix + clusterRoleBinding.roleRef.name
                for (const subj of clusterRoleBinding.subjects || []) {
                  subj.namespace = this.flags.chenamespace
                }

                if (await this.kh.isClusterRoleBindingExist(clusterRoleBinding.metadata!.name)) {
                  if (updateTask) {
                    await this.kh.replaceClusterRoleBinding(clusterRoleBinding)
                    task.title = `${task.title}...[Updated]`
                  } else {
                    task.title = `${task.title}...[Skipped: Exists]`
                  }
                } else {
                  await this.kh.createClusterRoleBinding(clusterRoleBinding)
                  task.title = `${task.title}...[Created]`
                }
              },
            }
          )
        }

        task.title = `${task.title}...[OK]`
        return rolesTasks
      },
    }
  }

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  async deployTasks(): Promise<Listr.ListrTask[]> {
    const kube = new KubeHelper(this.flags)
    const kubeTasks = new KubeTasks(this.flags)

    return [
      {
        title: `Create ServiceAccount ${OperatorTasks.SERVICE_ACCOUNT} in namespace ${this.flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isServiceAccountExist(OperatorTasks.SERVICE_ACCOUNT, this.flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'service_account.yaml')
            await this.kh.createServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      this.getCreateOrUpdateRolesAndBindingsTasks(false),
      {
        title: `Create CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await this.kh.getCrd(CHE_CLUSTER_CRD)
          if (existedCRD) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const newCRDPath = await this.getCRDPath(ctx, this.flags)
            await this.kh.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...[Created]`
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
          const exist = await this.kh.isConfigMapExists(OperatorTasks.MANAGER_CONFIG_MAP, this.flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'manager-config.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const configMap = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1ConfigMap
              await this.kh.createConfigMap(configMap, this.flags.chenamespace)
              task.title = `${task.title}...[Created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create Webhook Service ${OperatorTasks.MANAGER_CONFIG_MAP}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'webhook-service.yaml')
            if (fs.existsSync(yamlFilePath)) {
              await this.kh.createServiceFromFile(yamlFilePath, this.flags.chenamespace)
              task.title = `${task.title}...[Created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${this.flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const deploymentPath = path.join(ctx[ChectlContext.RESOURCES], 'operator.yaml')
            const operatorDeployment = await this.readOperatorDeployment(deploymentPath)
            await this.kh.createDeployment(operatorDeployment, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: `Create Certificate ${OperatorTasks.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isCertificateExists(OperatorTasks.CERTIFICATE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'serving-cert.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
              await this.kh.createCertificate(certificate, this.flags.chenamespace)
              task.title = `${task.title}...[Created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create Issuer ${OperatorTasks.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isIssuerExists(OperatorTasks.ISSUER, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Skipped: Exists]`
          } else {
            const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'selfsigned-issuer.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
              await this.kh.createIssuer(issuer, this.flags.chenamespace)
              task.title = `${task.title}...[Created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: 'Operator pod bootstrap',
        task: () => kubeTasks.podStartTasks(CHE_OPERATOR_SELECTOR, this.flags.chenamespace),
      },
      createEclipseCheClusterTask(this.flags, kube),
    ]
  }

  preUpdateTasks(): Listr {
    return new Listr([
      {
        title: 'Checking if operator deployment exists',
        task: async (ctx: any, task: any) => {
          const operatorDeployment = await this.kh.getDeployment(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
          if (!operatorDeployment) {
            cli.error(`${OPERATOR_DEPLOYMENT_NAME} deployment is not found in namespace ${this.flags.chenamespace}.\nProbably Eclipse Che was initially deployed with another installer`)
          }
          ctx.deployedCheOperatorYaml = operatorDeployment
          task.title = `${task.title}...[Found]`
        },
      },
      {
        title: 'Detecting existing version...',
        task: async (ctx: any, task: any) => {
          ctx.deployedCheOperatorImage = this.retrieveContainerImage(ctx.deployedCheOperatorYaml)
          const [deployedImage, deployedTag] = getImageNameAndTag(ctx.deployedCheOperatorImage)
          ctx.deployedCheOperatorImageName = deployedImage
          ctx.deployedCheOperatorImageTag = deployedTag

          if (this.flags['che-operator-image']) {
            ctx.newCheOperatorImage = this.flags['che-operator-image']
          } else {
            // Load new operator image from templates
            const newCheOperatorYaml = safeLoadFromYamlFile(path.join(this.flags.templates, OPERATOR_TEMPLATE_DIR, 'operator.yaml')) as V1Deployment
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
          const cheCluster = await this.kh.getCheClusterV1(this.flags.chenamespace)
          const isDevWorkspaceEngineDisabledBeforeUpdate = !cheCluster?.spec?.devWorkspace?.enable
          if (isDevWorkspaceEngineDisabledBeforeUpdate) {
            cli.error('Unsupported operation: it is not possible to update current Che installation to new version with enabled \'devWorkspace\' engine.')
          }
        },
      },
    ])
  }

  updateTasks(): Array<Listr.ListrTask> {
    return [
      {
        title: `Updating ServiceAccount ${OperatorTasks.SERVICE_ACCOUNT}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isServiceAccountExist(OperatorTasks.SERVICE_ACCOUNT, this.flags.chenamespace)
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'service_account.yaml')
          if (exist) {
            await this.kh.replaceServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      this.getCreateOrUpdateRolesAndBindingsTasks(true),
      {
        title: `Updating Eclipse Che cluster CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await this.kh.getCrd(CHE_CLUSTER_CRD)
          const newCRDPath = await this.getCRDPath(ctx, this.flags)

          if (existedCRD) {
            if (!existedCRD.metadata || !existedCRD.metadata.resourceVersion) {
              throw new Error(`Fetched CRD ${CHE_CLUSTER_CRD} without resource version`)
            }

            await this.kh.replaceCrdFromFile(newCRDPath)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...[Created]`
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
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const configMap = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1ConfigMap
          const exist = await this.kh.isConfigMapExists(OperatorTasks.MANAGER_CONFIG_MAP, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceConfigMap(OperatorTasks.MANAGER_CONFIG_MAP, configMap, this.flags.chenamespace)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createConfigMap(configMap, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: `Update Webhook Service ${OperatorTasks.WEBHOOK_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'webhook-service.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const service = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Service
          const exist = await this.kh.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceService(OperatorTasks.WEBHOOK_SERVICE, service, this.flags.chenamespace)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createService(service, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: `Updating deployment ${OPERATOR_DEPLOYMENT_NAME}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
          const deploymentPath = path.join(ctx[ChectlContext.RESOURCES], 'operator.yaml')
          const operatorDeployment = await this.readOperatorDeployment(deploymentPath)
          if (exist) {
            await this.kh.replaceDeployment(operatorDeployment)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createDeployment(operatorDeployment, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: `Update Certificate ${OperatorTasks.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'serving-cert.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
          const exist = await this.kh.isCertificateExists(OperatorTasks.CERTIFICATE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceCertificate(OperatorTasks.WEBHOOK_SERVICE, certificate, this.flags.chenamespace)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createCertificate(certificate, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: `Update Issuer ${OperatorTasks.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], 'selfsigned-issuer.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
          const exist = await this.kh.isIssuerExists(OperatorTasks.ISSUER, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceIssuer(OperatorTasks.WEBHOOK_SERVICE, issuer, this.flags.chenamespace)
            task.title = `${task.title}...[Updated]`
          } else {
            await this.kh.createIssuer(issuer, this.flags.chenamespace)
            task.title = `${task.title}...[Created]`
          }
        },
      },
      {
        title: 'Waiting newer operator to be run',
        task: async (_ctx: any, _task: any) => {
          await cli.wait(1000)
          await this.kh.waitLatestReplica(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
        },
      },
      patchingEclipseCheCluster(this.flags, this.kh),
    ]
  }

  /**
   * Returns list of tasks which remove Eclipse Che operator related resources
   */
  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kh = new KubeHelper(flags)
    return [{
      title: 'Delete OAuthClient',
      task: async (_ctx: any, task: any) => {
        try {
          const checluster = await kh.getCheClusterV1(flags.chenamespace)
          if (checluster?.spec?.auth?.oAuthClientName) {
            await kh.deleteOAuthClient(checluster?.spec?.auth?.oAuthClientName)
          }
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: `Delete Webhook Service ${OperatorTasks.WEBHOOK_SERVICE}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteService(OperatorTasks.WEBHOOK_SERVICE, this.flags.chenamespace)
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: `Delete ConfigMap ${OperatorTasks.MANAGER_CONFIG_MAP}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteConfigMap(OperatorTasks.MANAGER_CONFIG_MAP, this.flags.chenamespace)
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: `Delete Issuer ${OperatorTasks.ISSUER}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteIssuer(OperatorTasks.ISSUER, this.flags.chenamespace)
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: `Delete Certificate ${OperatorTasks.CERTIFICATE}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteCertificate(OperatorTasks.CERTIFICATE, this.flags.chenamespace)
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: `Delete the Custom Resource of type ${CHE_CLUSTER_CRD}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteAllCheClusters(flags.chenamespace)

          // wait 20 seconds, default timeout in che operator
          for (let index = 0; index < 20; index++) {
            await cli.wait(1000)
            if (!await kh.getCheClusterV1(flags.chenamespace)) {
              task.title = `${task.title}...[Deleted]`
              return
            }
          }

          // if checluster still exists then remove finalizers and delete again
          const checluster = await kh.getCheClusterV1(flags.chenamespace)
          if (checluster) {
            try {
              await kh.patchCheCluster(checluster.metadata.name, this.flags.chenamespace, {metadata: { finalizers: null } })
            } catch (error) {
              if (!await kh.getCheClusterV1(flags.chenamespace)) {
                task.title = `${task.title}...[Deleted]`
                return // successfully removed
              }
              throw error
            }

            // wait 2 seconds
            await cli.wait(2000)
          }

          if (!await kh.getCheClusterV1(flags.chenamespace)) {
            task.title = `${task.title}...[Deleted]`
          } else {
            task.title = `${task.title}...[Failed]`
          }
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: 'Delete CRDs',
      task: async (_ctx: any, task: any) => {
        try {
          const checlusters = await kh.getAllCheClusters()
          if (checlusters.length > 0) {
            task.title = `${task.title}...[Skipped: another Eclipse Che instance found]`
          } else {
            await kh.deleteCrd(CHE_CLUSTER_CRD)
            task.title = `${task.title}...[Deleted]`
          }
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    },
    {
      title: 'Delete Roles and Bindings',
      task: async (ctx: any, task: any) => {
        const roleBindings = await kh.listRoleBindings(flags.chenamespace)
        for (const roleBinding of roleBindings.items) {
          await kh.deleteRoleBinding(roleBinding.metadata!.name!, this.flags.chenamespace)
        }

        const roles = await kh.listRoles(flags.chenamespace)
        for (const role of roles.items) {
          await kh.deleteRole(role.metadata!.name!, this.flags.chenamespace)
        }

        const clusterRoleBindings = await kh.listClusterRoleBindings()
        for (const clusterRoleBinding of clusterRoleBindings.items) {
          const name = clusterRoleBinding.metadata && clusterRoleBinding.metadata.name || ''
          if (name.startsWith(flags.chenamespace) || name.startsWith(OperatorTasks.DEVWORKSPACE_PREFIX)) {
            await kh.deleteClusterRoleBinding(name)
          }
        }

        const clusterRoles = await kh.listClusterRoles()
        for (const clusterRole of clusterRoles.items) {
          const name = clusterRole.metadata && clusterRole.metadata.name || ''
          if (name.startsWith(flags.chenamespace) || name.startsWith(OperatorTasks.DEVWORKSPACE_PREFIX)) {
            await kh.deleteClusterRole(name)
          }
        }

        task.title = `${task.title}...[Deleted]`
      },
    },
    {
      title: `Delete ServiceAccount ${OperatorTasks.SERVICE_ACCOUNT}`,
      task: async (_ctx: any, task: any) => {
        try {
          await kh.deleteServiceAccount(OperatorTasks.SERVICE_ACCOUNT, this.flags.chenamespace)
          task.title = `${task.title}...[Deleted]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
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
  private async readOperatorDeployment(path: string): Promise<V1Deployment> {
    const operatorDeployment = safeLoadFromYamlFile(path) as V1Deployment

    if (!operatorDeployment.metadata || !operatorDeployment.metadata!.name) {
      throw new Error(`Deployment read from ${path} must have name specified`)
    }

    if (this.flags['che-operator-image']) {
      const container = operatorDeployment.spec!.template.spec!.containers.find(c => c.name === 'che-operator')
      if (container) {
        container.image = this.flags['che-operator-image']
      } else {
        throw new Error(`Container 'che-operator' not found in deployment '${operatorDeployment.metadata!.name}'`)
      }
    }

    if (this.flags.chenamespace) {
      operatorDeployment.metadata!.namespace = this.flags.chenamespace
    }

    if (!await this.kh.IsAPIExtensionSupported('v1')) {
      const containers = operatorDeployment.spec!.template.spec!.containers || []
      operatorDeployment.spec!.template.spec!.containers = containers.filter(c => c.name === 'che-operator')
    }

    return operatorDeployment
  }

  private collectReadRolesAndBindings(ctx: any): any {
    const resources: any = {}
    resources.roles = []
    resources.roleBindings = []
    resources.clusterRoles = []
    resources.clusterRoleBindings = []

    const filesList = fs.readdirSync(ctx[ChectlContext.RESOURCES])
    for (const fileName of filesList) {
      if (!fileName.endsWith('.yaml')) {
        continue
      }
      const yamlFilePath = path.join(ctx[ChectlContext.RESOURCES], fileName)
      const yamlContent = this.kh.safeLoadFromYamlFile(yamlFilePath)
      if (!(yamlContent && yamlContent.kind)) {
        continue
      }
      switch (yamlContent.kind) {
      case 'Role':
        resources.roles.push(yamlContent)
        break
      case 'RoleBinding':
        resources.roleBindings.push(yamlContent)
        break
      case 'ClusterRole':
        resources.clusterRoles.push(yamlContent)
        break
      case 'ClusterRoleBinding':
        resources.clusterRoleBindings.push(yamlContent)
        break
      default:
        // Ignore this object kind
      }
    }

    // Check consistancy
    if (resources.roles.length !== resources.roleBindings.length) {
      cli.warn('Number of Roles and Role Bindings is different')
    }
    if (resources.clusterRoles.length !== resources.clusterRoleBindings.length) {
      cli.warn('Number of Cluster Roles and Cluster Role Bindings is different')
    }

    return resources
  }
}
