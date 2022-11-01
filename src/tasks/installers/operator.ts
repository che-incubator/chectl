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
  V1CustomResourceDefinition, V1ValidatingWebhookConfiguration, V1MutatingWebhookConfiguration,
} from '@kubernetes/client-node'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import {
  CERT_MANAGER_NAMESPACE_NAME,
  CHE_CLUSTER_API_GROUP,
  CHE_CLUSTER_API_VERSION_V2,
  CHE_CLUSTER_CRD, CHE_CLUSTER_KIND_PLURAL, CHE_FLAVOR,
  CHE_OPERATOR_SELECTOR,
  OPERATOR_DEPLOYMENT_NAME,
} from '../../constants'
import { getImageNameAndTag, safeLoadFromYamlFile } from '../../util'
import { KubeTasks } from '../kube'
import { createEclipseCheClusterTask, patchingEclipseCheCluster } from './common-tasks'
import { V1Certificate } from '../../api/types/cert-manager'
import { OpenShiftHelper } from '../../api/openshift'
import { Installer } from '../../api/types/installer'

export class OperatorInstaller implements Installer {
  private static readonly PROMETHEUS = 'prometheus-k8s'
  private static readonly VALIDATING_WEBHOOK = 'org.eclipse.che'
  private static readonly MUTATING_WEBHOOK = 'org.eclipse.che'
  private static readonly OPERATOR_SERVICE = 'che-operator-service'
  private static readonly OPERATOR_SERVICE_CERT = 'che-operator-webhook-server-cert'
  private static readonly CERTIFICATE = 'che-operator-serving-cert'
  private static readonly ISSUER = 'che-operator-selfsigned-issuer'
  private static readonly SERVICE_ACCOUNT = 'che-operator'
  private static readonly CONSOLELINK = 'che'

  protected kh: KubeHelper
  protected oc: OpenShiftHelper

  constructor(protected readonly flags: any) {
    this.kh = new KubeHelper(this.flags)
    this.oc = new OpenShiftHelper()
  }

  private getCreateOrUpdateRolesAndBindingsTasks(updateTask = false): Listr.ListrTask {
    return {
      title: `${updateTask ? 'Update' : 'Create'} Role and RoleBindings`,
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
                    task.title = `${task.title}...[Exists]`
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
                    task.title = `${task.title}...[Exists]`
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
                    clusterRole.metadata!.name = clusterRoleName
                    await this.kh.replaceClusterRoleFromObj(clusterRole)
                    task.title = `${task.title}...[OK: updated]`
                  } else {
                    task.title = `${task.title}...[Exists]`
                  }
                } else {
                  clusterRole.metadata!.name = clusterRoleName
                  await this.kh.createClusterRole(clusterRole)
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
                    task.title = `${task.title}...[Exists]`
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
  getDeployTasks(): Listr.ListrTask<any>[] {
    const kube = new KubeHelper(this.flags)
    const kubeTasks = new KubeTasks(this.flags)

    return [
      {
        title: `Create ServiceAccount ${OperatorInstaller.SERVICE_ACCOUNT} in namespace ${this.flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isServiceAccountExist(OperatorInstaller.SERVICE_ACCOUNT, this.flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = this.getResourcePath('service_account.yaml')
            await this.kh.createServiceAccountFromFile(yamlFilePath, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      this.getCreateOrUpdateRolesAndBindingsTasks(false),
      {
        title: 'Wait for Cert Manager',
        task: async (ctx: any, task: any) => {
          await this.kh.waitForPodReady('app.kubernetes.io/name=cert-manager', CERT_MANAGER_NAMESPACE_NAME)
          await this.kh.waitForPodReady('app.kubernetes.io/name=webhook', CERT_MANAGER_NAMESPACE_NAME)
          await this.kh.waitForPodReady('app.kubernetes.io/name=cainjector', CERT_MANAGER_NAMESPACE_NAME)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: `Create Certificate ${OperatorInstaller.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isCertificateExists(OperatorInstaller.CERTIFICATE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = this.getResourcePath('serving-cert.yaml')
            if (fs.existsSync(yamlFilePath)) {
              const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
              certificate.spec.dnsNames = [`${OperatorInstaller.OPERATOR_SERVICE}.${this.flags.chenamespace}.svc`, `${OperatorInstaller.OPERATOR_SERVICE}.${this.flags.chenamespace}.svc.cluster.local`]

              await this.kh.createCertificate(certificate, this.flags.chenamespace)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Skipped: Not found]`
            }
          }
        },
      },
      {
        title: `Create Issuer ${OperatorInstaller.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isIssuerExists(OperatorInstaller.ISSUER, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
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
        title: `Create Service ${OperatorInstaller.OPERATOR_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isServiceExists(OperatorInstaller.OPERATOR_SERVICE, this.flags.chenamespace)
          if (exists) {
            task.title = `${task.title}...[Exists]`
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
          const existedCRD = await this.kh.getCustomResourceDefinition(CHE_CLUSTER_CRD)
          if (existedCRD) {
            task.title = `${task.title}...[Exists]`
          } else {
            const crdPath = await this.getCRDPath()
            const crd = this.kh.safeLoadFromYamlFile(crdPath) as V1CustomResourceDefinition
            crd.spec.conversion!.webhook!.clientConfig!.service!.namespace = this.flags.chenamespace
            crd.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`

            await this.kh.createCrd(crd)
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
            task.title = `${task.title}...[Exists]`
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
      {
        title: `Create ValidatingWebhookConfiguration ${OperatorInstaller.VALIDATING_WEBHOOK}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isValidatingWebhookConfigurationExists(OperatorInstaller.VALIDATING_WEBHOOK)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const webhookPath = this.getResourcePath('org.eclipse.che.ValidatingWebhookConfiguration.yaml')
            if (fs.existsSync(webhookPath)) {
              const webhook = this.kh.safeLoadFromYamlFile(webhookPath) as V1ValidatingWebhookConfiguration
              webhook!.webhooks![0].clientConfig.service!.namespace = this.flags.chenamespace
              webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`
              await this.kh.createValidatingWebhookConfiguration(webhook)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Not found]`
            }
          }
        },
      },
      {
        title: `Create MutatingWebhookConfiguration ${OperatorInstaller.MUTATING_WEBHOOK}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kh.isMutatingWebhookConfigurationExists(OperatorInstaller.MUTATING_WEBHOOK)
          if (exists) {
            task.title = `${task.title}...[Exists]`
          } else {
            const webhookPath = this.getResourcePath('org.eclipse.che.MutatingWebhookConfiguration.yaml')
            if (fs.existsSync(webhookPath)) {
              const webhook = this.kh.safeLoadFromYamlFile(webhookPath) as V1MutatingWebhookConfiguration
              webhook!.webhooks![0].clientConfig.service!.namespace = this.flags.chenamespace
              webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`
              await this.kh.createMutatingWebhookConfiguration(webhook)
              task.title = `${task.title}...[OK: created]`
            } else {
              task.title = `${task.title}...[Not found]`
            }
          }
        },
      },
      createEclipseCheClusterTask(this.flags, kube),
    ]
  }

  getPreUpdateTasks(): Listr.ListrTask<any>[] {
    return [
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
          const isDevWorkspaceEnabled = await this.kh.getConfigMapValue('che', this.flags.chenamespace, 'CHE_DEVWORKSPACES_ENABLED')
          const isDevWorkspaceEngineDisabledBeforeUpdate = isDevWorkspaceEnabled !== 'true'
          if (isDevWorkspaceEngineDisabledBeforeUpdate) {
            cli.error('Unsupported operation: it is not possible to update current Che installation to new a version with \'devWorkspace\' engine enabled.')
          }
        },
      },
    ]
  }

  getUpdateTasks(): Listr.ListrTask<any>[] {
    return [
      {
        title: `Update ServiceAccount ${OperatorInstaller.SERVICE_ACCOUNT}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kh.isServiceAccountExist(OperatorInstaller.SERVICE_ACCOUNT, this.flags.chenamespace)
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
        title: `Update Certificate ${OperatorInstaller.CERTIFICATE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('serving-cert.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
          certificate.spec.dnsNames = [`${OperatorInstaller.OPERATOR_SERVICE}.${this.flags.chenamespace}.svc`, `${OperatorInstaller.OPERATOR_SERVICE}.${this.flags.chenamespace}.svc.cluster.local`]

          const exist = await this.kh.isCertificateExists(OperatorInstaller.CERTIFICATE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceCertificate(OperatorInstaller.CERTIFICATE, certificate, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createCertificate(certificate, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      {
        title: `Update Issuer ${OperatorInstaller.ISSUER}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('selfsigned-issuer.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
          const exist = await this.kh.isIssuerExists(OperatorInstaller.ISSUER, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceIssuer(OperatorInstaller.ISSUER, issuer, this.flags.chenamespace)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createIssuer(issuer, this.flags.chenamespace)
            task.title = `${task.title}...[OK: created]`
          }
        },
      },
      {
        title: `Update Service ${OperatorInstaller.OPERATOR_SERVICE}`,
        task: async (ctx: any, task: any) => {
          const yamlFilePath = this.getResourcePath('webhook-service.yaml')
          if (!fs.existsSync(yamlFilePath)) {
            task.title = `${task.title}...[Skipped: Not found]`
            return
          }

          const service = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Service
          const exist = await this.kh.isServiceExists(OperatorInstaller.OPERATOR_SERVICE, this.flags.chenamespace)
          if (exist) {
            await this.kh.replaceService(OperatorInstaller.OPERATOR_SERVICE, service, this.flags.chenamespace)
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
          const existedCRD = await this.kh.getCustomResourceDefinition(CHE_CLUSTER_CRD)

          const crdPath = await this.getCRDPath()
          const crd = this.kh.safeLoadFromYamlFile(crdPath) as V1CustomResourceDefinition
          crd.spec.conversion!.webhook!.clientConfig!.service!.namespace = this.flags.chenamespace
          crd.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`

          if (existedCRD) {
            await this.kh.replaceCustomResourceDefinition(crd)
            task.title = `${task.title}...[OK: updated]`
          } else {
            await this.kh.createCrd(crd)
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
      {
        title: `Update ValidatingWebhookConfiguration ${OperatorInstaller.VALIDATING_WEBHOOK}`,
        task: async (ctx: any, task: any) => {
          const webhookPath = this.getResourcePath('org.eclipse.che.ValidatingWebhookConfiguration.yaml')
          if (fs.existsSync(webhookPath)) {
            const webhook = this.kh.safeLoadFromYamlFile(webhookPath) as V1ValidatingWebhookConfiguration
            webhook!.webhooks![0].clientConfig.service!.namespace = this.flags.chenamespace
            webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`

            const exists = await this.kh.isValidatingWebhookConfigurationExists(OperatorInstaller.VALIDATING_WEBHOOK)
            if (exists) {
              await this.kh.replaceValidatingWebhookConfiguration(OperatorInstaller.VALIDATING_WEBHOOK, webhook)
              task.title = `${task.title}...[Ok: updated]`
            } else {
              await this.kh.createValidatingWebhookConfiguration(webhook)
              task.title = `${task.title}...[OK: created]`
            }
          } else {
            task.title = `${task.title}...[Not found]`
          }
        },
      },
      {
        title: `Update MutatingWebhookConfiguration ${OperatorInstaller.MUTATING_WEBHOOK}`,
        task: async (ctx: any, task: any) => {
          const webhookPath = this.getResourcePath('org.eclipse.che.MutatingWebhookConfiguration.yaml')
          if (fs.existsSync(webhookPath)) {
            const webhook = this.kh.safeLoadFromYamlFile(webhookPath) as V1MutatingWebhookConfiguration
            webhook!.webhooks![0].clientConfig.service!.namespace = this.flags.chenamespace
            webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${this.flags.chenamespace}/${OperatorInstaller.CERTIFICATE}`

            const exists = await this.kh.isMutatingWebhookConfigurationExists(OperatorInstaller.MUTATING_WEBHOOK)
            if (exists) {
              await this.kh.replaceVMutatingWebhookConfiguration(OperatorInstaller.MUTATING_WEBHOOK, webhook)
              task.title = `${task.title}...[Ok: updated]`
            } else {
              await this.kh.createMutatingWebhookConfiguration(webhook)
              task.title = `${task.title}...[OK: created]`
            }
          } else {
            task.title = `${task.title}...[Not found]`
          }
        },
      },
      patchingEclipseCheCluster(this.flags, this.kh),
    ]
  }

  /**
   * Returns list of tasks which remove Eclipse Che operator related resources
   */
  getDeleteTasks(): Listr.ListrTask<any>[] {
    const kh = new KubeHelper(this.flags)
    return [
      {
        title: 'Delete cluster scope objects',
        task: async (ctx: any, task: any) => {
          try {
            // Webhooks
            await kh.deleteValidatingWebhookConfiguration(OperatorInstaller.VALIDATING_WEBHOOK)
            await kh.deleteMutatingWebhookConfiguration(OperatorInstaller.MUTATING_WEBHOOK)

            if (ctx[ChectlContext.IS_OPENSHIFT]) {
              const checluster = await kh.getCheClusterV2(this.flags.chenamespace)

              // ConsoleLink
              await this.kh.deleteClusterCustomObject('console.openshift.io', 'v1', 'consolelinks', OperatorInstaller.CONSOLELINK)

              // OAuthClient
              const oAuthClientName = checluster?.spec?.networking?.auth?.oAuthClientName || `${this.flags.chenamespace}-client`
              await kh.deleteClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclients', oAuthClientName)

              // SCC
              const sccName = checluster?.spec?.devEnvironments?.containerBuildConfiguration?.openShiftSecurityContextConstraint || 'container-build'
              const scc = await kh.getClusterCustomObject('security.openshift.io', 'v1', 'securitycontextconstraints', sccName)
              if (scc?.metadata?.labels?.['app.kubernetes.io/managed-by'] === `${CHE_FLAVOR}-operator`) {
                task.title = `${task.title} ${sccName}`
                await kh.deleteClusterCustomObject('security.openshift.io', 'v1', 'securitycontextconstraints', sccName)
              }
            }

            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete ${CHE_CLUSTER_KIND_PLURAL}.${CHE_CLUSTER_API_GROUP} resources`,
        task: async (_ctx: any, task: any) => {
          try {
            await kh.deleteAllCustomResourcesAndCrd(CHE_CLUSTER_CRD, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION_V2, CHE_CLUSTER_KIND_PLURAL)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Networks',
        enabled: (ctx: any) => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (ctx: any, task: any) => {
          try {
            await this.kh.deleteService(OperatorInstaller.OPERATOR_SERVICE, this.flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Workloads',
        task: async (ctx: any, task: any) => {
          try {
            const cms = await this.kh.listConfigMaps(this.flags.chenamespace, 'app.kubernetes.io/part-of=che.eclipse.org,app.kubernetes.io/component=gateway-config')
            for (const cm of cms) {
              await this.kh.deleteConfigMap(cm.metadata!.name!, this.flags.chenamespace)
            }

            if (!ctx[ChectlContext.IS_OPENSHIFT]) {
              await this.kh.deleteSecret(OperatorInstaller.OPERATOR_SERVICE_CERT, this.flags.chenamespace)
              await this.kh.deleteDeployment(OPERATOR_DEPLOYMENT_NAME, this.flags.chenamespace)

              const pods = await this.kh.listNamespacedPod(this.flags.chenamespace, undefined, 'app.kubernetes.io/part-of=che.eclipse.org,app.kubernetes.io/component=che-create-tls-secret-job')
              for (const pod of pods.items) {
                await this.kh.deletePod(pod.metadata!.name!, pod.metadata!.namespace!)
              }
            }

            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete RBAC',
        task: async (ctx: any, task: any) => {
          try {
            if (ctx[ChectlContext.IS_OPENSHIFT]) {
              await kh.deleteRole(OperatorInstaller.PROMETHEUS, this.flags.chenamespace)
              await kh.deleteRoleBinding(OperatorInstaller.PROMETHEUS, this.flags.chenamespace)
              await kh.deleteClusterRole(`${CHE_FLAVOR}-user-container-build`)
              await kh.deleteClusterRole('dev-workspace-container-build')
              await kh.deleteClusterRoleBinding('dev-workspace-container-build')
            } else {
              await kh.deleteRole('che-operator', this.flags.chenamespace)
              await kh.deleteRole('che-operator-leader-election', this.flags.chenamespace)
              await kh.deleteRoleBinding('che-operator', this.flags.chenamespace)
              await kh.deleteRoleBinding('che-operator-leader-election', this.flags.chenamespace)
              await kh.deleteClusterRole(`${this.flags.chenamespace}-che-operator`)
              await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-che-operator`)
              await this.kh.deleteServiceAccount(OperatorInstaller.SERVICE_ACCOUNT, this.flags.chenamespace)
            }

            await kh.deleteClusterRole(`${this.flags.chenamespace}-che-gateway`)
            await kh.deleteClusterRole(`${this.flags.chenamespace}-che-dashboard`)
            await kh.deleteClusterRole(`${this.flags.chenamespace}-cheworkspaces-namespaces-clusterrole`)
            await kh.deleteClusterRole(`${this.flags.chenamespace}-cheworkspaces-clusterrole`)
            await kh.deleteClusterRole(`${this.flags.chenamespace}-cheworkspaces-devworkspace-clusterrole`)

            await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-che-gateway`)
            await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-che-dashboard`)
            await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-cheworkspaces-namespaces-clusterrole`)
            await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-cheworkspaces-clusterrole`)
            await kh.deleteClusterRoleBinding(`${this.flags.chenamespace}-cheworkspaces-devworkspace-clusterrole`)

            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Certificates',
        enabled: (ctx: any) => !ctx[ChectlContext.IS_OPENSHIFT],
        task: async (_ctx: any, task: any) => {
          try {
            await kh.deleteIssuer(OperatorInstaller.ISSUER, this.flags.chenamespace)
            await kh.deleteCertificate(OperatorInstaller.CERTIFICATE, this.flags.chenamespace)
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

    for (const basePath of [ctx[ChectlContext.CHE_OPERATOR_RESOURCES], path.join(ctx[ChectlContext.CHE_OPERATOR_RESOURCES], 'kubernetes')]) {
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
    return path.join(ctx[ChectlContext.CHE_OPERATOR_RESOURCES], 'kubernetes', 'crds', 'org.eclipse.che_checlusters.yaml')
  }

  /**
   * Finds resource and returns its path.
   */
  private getResourcePath(resourceName: string): string {
    const ctx = ChectlContext.get()
    return path.join(ctx[ChectlContext.CHE_OPERATOR_RESOURCES], 'kubernetes', resourceName)
  }
}
