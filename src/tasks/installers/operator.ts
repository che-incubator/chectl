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

import {
  V1ClusterRole,
  V1ClusterRoleBinding,
  V1Deployment,
  V1Role,
  V1RoleBinding,
  V1Service,
} from '@kubernetes/client-node'
import {cli} from 'cli-ux'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as path from 'path'
import * as yaml from 'js-yaml'
import {ChectlContext} from '../../api/context'
import {KubeHelper} from '../../api/kube'
import {CHE_CLUSTER_CRD, CHE_OPERATOR_SELECTOR, OPERATOR_DEPLOYMENT_NAME} from '../../constants'
import {getImageNameAndTag, isCheClusterAPIV1, safeLoadFromYamlFile} from '../../util'
import {KubeTasks} from '../kube'
import {createEclipseCheClusterTask, patchingEclipseCheCluster} from './common-tasks'
import {V1Certificate} from '../../api/types/cert-manager'
import {OpenShiftHelper} from '../../api/openshift'

export class OperatorTasks {
  private static readonly WEBHOOK_SERVICE = 'che-operator-service'
  private static readonly CERTIFICATE = 'che-operator-serving-cert'
  private static readonly ISSUER = 'che-operator-selfsigned-issuer'
  private static readonly SERVICE_ACCOUNT = 'che-operator'
  private static readonly DEVWORKSPACE_PREFIX = 'devworkspace-che'
  private static readonly CONSOLELINK = 'che'

  protected kh: KubeHelper
  protected oc: OpenShiftHelper

  constructor(protected readonly flags: any) {
    this.kh = new KubeHelper(flags)
    this.oc = new OpenShiftHelper()
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
                    task.title = `${task.title}...[OK: updated]`
                  } else {
                    task.title = `${task.title}...[Exists]]`
                  }
                } else {
                  await this.kh.createRole(role, this.flags.chenamespace)
                  task.title = `${task.title}...[OK: created]`
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
                    task.title = `${task.title}...[OK: updated]`
                  } else {
                    task.title = `${task.title}...[Exists]]`
                  }
                } else {
                  await this.kh.createRoleBinding(roleBinding, this.flags.chenamespace)
                  task.title = `${task.title}...[OK: created]`
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
                    task.title = `${task.title}...[OK: updated]`
                  } else {
                    task.title = `${task.title}...[Exists]]`
                  }
                } else {
                  await this.kh.createClusterRole(clusterRole, clusterRoleName)
                  task.title = `${task.title}...[OK: created]`
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
                    task.title = `${task.title}...[OK: updated]`
                  } else {
                    task.title = `${task.title}...[Exists]]`
                  }
                } else {
                  await this.kh.createClusterRoleBinding(clusterRoleBinding)
                  task.title = `${task.title}...[OK: created]`
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
            task.title = `${task.title}...[Exists]]`
          } else {
            const yamlFilePath = this.getResourcePath('service_account.yaml')
            await this.kh.createServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      this.getCreateOrUpdateRolesAndBindingsTasks(false),
      {
        title: `Create Certificate ${OperatorTasks.CERTIFICATE}`,
        enabled: ctx => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isCertificateExists(OperatorTasks.CERTIFICATE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]]`
          } else {
            const yamlFilePath = this.getResourcePath('serving-cert.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
              await this.kh.createCertificate(certificate, this.flags.chenamespace)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create Issuer ${OperatorTasks.ISSUER}`,
        enabled: ctx => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isIssuerExists(OperatorTasks.ISSUER, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]]`
          } else {
            const yamlFilePath = this.getResourcePath('selfsigned-issuer.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
              await this.kh.createIssuer(issuer, this.flags.chenamespace)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create Service ${OperatorTasks.WEBHOOK_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]]`
          } else {
            const yamlFilePath = this.getResourcePath('webhook-service.yaml')
            if (fs.existsSync(yamlFilePath)) {
              await this.kh.createServiceFromFile(yamlFilePath, this.flags.chenamespace)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await this.kh.getCrd(CHE_CLUSTER_CRD)
          if (existedCRD) {
            task.title = `${task.title}...[Exists]]`
          } else {
            const newCRDPath = await this.getCRDPath()
            await this.kh.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...[OK: created]`
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
        title: `Create deployment ${OPERATOR_DEPLOYMENT_NAME} in namespace ${this.flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]]`
          } else {
            const deploymentPath = this.getResourcePath('operator.yaml')
            const operatorDeployment = await this.readOperatorDeployment(deploymentPath)
            await this.kh.createDeployment(operatorDeployment, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
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
            const newCheOperatorYaml = safeLoadFromYamlFile(this.getResourcePath('operator.yaml')) as V1Deployment
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
        title: `Update ServiceAccount ${OperatorTasks.SERVICE_ACCOUNT}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isServiceAccountExist(OperatorTasks.SERVICE_ACCOUNT, this.flags.chenamespace)
          const yamlFilePath = this.getResourcePath('service_account.yaml')
          if (exist) {
            await this.kh.replaceServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      this.getCreateOrUpdateRolesAndBindingsTasks(true),
      {
        title: `Update Certificate ${OperatorTasks.CERTIFICATE}`,
        enabled: ctx => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('serving-cert.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
          const exist = await this.kh.isCertificateExists(OperatorTasks.CERTIFICATE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceCertificate(OperatorTasks.CERTIFICATE, certificate, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createCertificate(certificate, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      {
        title: `Update Issuer ${OperatorTasks.ISSUER}`,
        enabled: ctx => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('selfsigned-issuer.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
          const exist = await this.kh.isIssuerExists(OperatorTasks.ISSUER, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceIssuer(OperatorTasks.ISSUER, issuer, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createIssuer(issuer, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      {
        title: `Update Service ${OperatorTasks.WEBHOOK_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('webhook-service.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const service = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Service
          const exist = await this.kh.isServiceExists(OperatorTasks.WEBHOOK_SERVICE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceService(OperatorTasks.WEBHOOK_SERVICE, service, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createService(service, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      {
        title: `Update Eclipse Che cluster CRD ${CHE_CLUSTER_CRD}`,
        task: async (ctx: any, task: any) => {
          const existedCRD = await this.kh.getCrd(CHE_CLUSTER_CRD)
          const newCRDPath = await this.getCRDPath()

          if (existedCRD) {
            if (!existedCRD.metadata || !existedCRD.metadata.resourceVersion) {
              throw new Error(`Fetched CRD ${CHE_CLUSTER_CRD} without resource version`)
            }

            await this.kh.replaceCrdFromFile(newCRDPath)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createCrdFromFile(newCRDPath)
            task.title = `${task.title}...[OK: created]`
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
        title: `Update deployment ${OPERATOR_DEPLOYMENT_NAME}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isDeploymentExist(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)
          const deploymentPath = this.getResourcePath('operator.yaml')
          const operatorDeployment = await this.readOperatorDeployment(deploymentPath)
          if (exist) {
            await this.kh.replaceDeployment(operatorDeployment)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createDeployment(operatorDeployment, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
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
  getDeleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kh = new KubeHelper(flags)
    return [
      {
        title: `Delete Issuer ${OperatorTasks.ISSUER}`,
        task: async (_ctx: any, task: any) => {
          try {
            await kh.deleteIssuer(OperatorTasks.ISSUER, this.flags.chenamespace)
            task.title = `${task.title}...[Ok]`
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
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete OAuthClient',
        enabled: (ctx: any) => ctx[ChectlContext.IS_OPENSHIFT],
        task: async (_ctx: any, task: any) => {
          try {
            const checluster = await kh.getCheClusterV1(flags.chenamespace)
            if (checluster) {
              if (isCheClusterAPIV1(checluster)) {
                if (checluster?.spec?.auth?.oAuthClientName) {
                  await kh.deleteOAuthClient(checluster.spec.auth.oAuthClientName)
                }
              } else {
                if (checluster?.spec?.networking?.auth?.oAuthClientName) {
                  await kh.deleteOAuthClient(checluster.spec.networking.auth.oAuthClientName)
                }
              }
            }

            const oauthClients = await kh.listOAuthClientBySelector('app.kubernetes.io/part-of=che.eclipse.org')
            for (const oauthClient of oauthClients) {
              await kh.deleteOAuthClient(oauthClient.metadata.name)
            }

            task.title = `${task.title}...[Ok]`
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
                task.title = `${task.title}...[Ok]`
                return
              }
            }

            // if checluster still exists then remove finalizers and delete again
            const checluster = await kh.getCheClusterV1(flags.chenamespace)
            if (checluster) {
              try {
                await kh.patchCheCluster(checluster.metadata.name, this.flags.chenamespace, {apiVersion: 'org.eclipse.che/v2', metadata: {finalizers: null}})
              } catch (error) {
                if (!await kh.getCheClusterV1(flags.chenamespace)) {
                  task.title = `${task.title}...[Ok]`
                  return // successfully removed
                }
                throw error
              }

              // wait 2 seconds
              await cli.wait(2000)
            }

            if (!await kh.getCheClusterV1(flags.chenamespace)) {
              task.title = `${task.title}...[Ok]`
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
            await kh.deleteCrd(CHE_CLUSTER_CRD)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Deployments',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteAllDeployments(flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Services',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteAllServices(flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Ingresses',
        enabled: (ctx: any) => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteAllIngresses(flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Routes',
        enabled: (ctx: any) => ctx[ChectlContext.IS_OPENSHIFT],
        task: async (_ctx: any, task: any) => {
          try {
            await this.oc.deleteAllRoutes(flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Secrets',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteSecret('che-operator-webhook-server-cert', flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete ConfigMaps',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteConfigMap('che', flags.chenamespace)
            await this.kh.deleteConfigMap('ca-certs-merged', flags.chenamespace)
            await this.kh.deleteConfigMap('plugin-registry', flags.chenamespace)
            await this.kh.deleteConfigMap('devfile-registry', flags.chenamespace)

            const configMaps = await this.kh.listConfigMaps(flags.chenamespace)
            for (const configMap of configMaps) {
              const configMapName = configMap.metadata!.name!
              if (configMapName.startsWith('che-gateway')) {
                await this.kh.deleteConfigMap(configMapName, flags.chenamespace)
              }
            }
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete RoleBindings',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteRoleBinding('che-gateway', flags.chenamespace)
            await this.kh.deleteRoleBinding('che-tls-job-role-binding', flags.chenamespace)

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

            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Roles',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteRole('che-gateway', flags.chenamespace)
            await this.kh.deleteRole('che-tls-job-role', flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete ClusterRoles',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteClusterRole(`${flags.chenamespace}-che-dashboard`)
            await this.kh.deleteClusterRole(`${flags.chenamespace}-che-gateway`)
            await this.kh.deleteClusterRole(`${flags.chenamespace}-cheworkspaces-clusterrole`)
            await this.kh.deleteClusterRole(`${flags.chenamespace}-cheworkspaces-devworkspace-clusterrole`)
            await this.kh.deleteClusterRole(`${flags.chenamespace}-cheworkspaces-namespaces-clusterrole`)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete ClusterRoleBindings',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteClusterRoleBinding(`${flags.chenamespace}-che-dashboard`)
            await this.kh.deleteClusterRoleBinding(`${flags.chenamespace}-che-gateway`)
            await this.kh.deleteClusterRoleBinding(`${flags.chenamespace}-cheworkspaces-clusterrole`)
            await this.kh.deleteClusterRoleBinding(`${flags.chenamespace}-cheworkspaces-devworkspace-clusterrole`)
            await this.kh.deleteClusterRoleBinding(`${flags.chenamespace}-cheworkspaces-namespaces-clusterrole`)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete ServiceAccounts',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteServiceAccount('che', flags.chenamespace)
            await this.kh.deleteServiceAccount('che-dashboard', flags.chenamespace)
            await this.kh.deleteServiceAccount('che-gateway', flags.chenamespace)
            await this.kh.deleteServiceAccount('che-tls-job-service-account', flags.chenamespace)
            await this.kh.deleteServiceAccount(OperatorTasks.SERVICE_ACCOUNT, flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete PVCs',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deletePersistentVolumeClaim('postgres-data', flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete ConsoleLink ${OperatorTasks.CONSOLELINK}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.deleteConsoleLink(OperatorTasks.CONSOLELINK)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
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

    return operatorDeployment
  }

  private collectReadRolesAndBindings(ctx: any): any {
    const resources: any = {}
    resources.roles = []
    resources.roleBindings = []
    resources.clusterRoles = []
    resources.clusterRoleBindings = []

    const platform = ctx[ChectlContext.IS_OPENSHIFT] ? 'openshift' : 'kubernetes'
    for (const basePath of [ctx[ChectlContext.RESOURCES], path.join(ctx[ChectlContext.RESOURCES], platform)]) {
      if (!fs.existsSync(basePath)) {
        continue
      }

      const filesList = fs.readdirSync(basePath)
      for (const fileName of filesList) {
        if (!fileName.endsWith('.yaml')) {
          continue
        }
        const yamlContent = this.kh.safeLoadFromYamlFile(path.join(basePath, fileName))
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
    }

    // Check consistency
    if (resources.roles.length !== resources.roleBindings.length) {
      cli.warn('Number of Roles and Role Bindings is different')
    }
    if (resources.clusterRoles.length !== resources.clusterRoleBindings.length) {
      cli.warn('Number of Cluster Roles and Cluster Role Bindings is different')
    }

    return resources
  }

  /**
   * Returns CheCluster CRD file path depending on its version.
   */
  async getCRDPath(): Promise<string> {
    const ctx = ChectlContext.get()

    // Legacy CRD CheCluster API v1
    const crdPath = path.join(ctx[ChectlContext.RESOURCES], 'crds', 'org_v1_che_crd.yaml')
    if (fs.existsSync(crdPath)) {
      return crdPath
    }

    // Platform specific resource
    const platform = ctx[ChectlContext.IS_OPENSHIFT] ? 'openshift' : 'kubernetes'
    return path.join(ctx[ChectlContext.RESOURCES], platform, 'crds', 'org.eclipse.che_checlusters.yaml')
  }

  /**
   * Finds resource and returns its path.
   */
  private getResourcePath(resourceName: string): string {
    const ctx = ChectlContext.get()

    // legacy path
    const resourcePath = path.join(ctx[ChectlContext.RESOURCES], resourceName)
    if (fs.existsSync(resourcePath)) {
      return resourcePath
    }

    // Platform specific resource
    const platform = ctx[ChectlContext.IS_OPENSHIFT] ? 'openshift' : 'kubernetes'
    return path.join(ctx[ChectlContext.RESOURCES], platform, resourceName)
  }
}
