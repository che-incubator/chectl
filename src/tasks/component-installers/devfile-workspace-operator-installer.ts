/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { V1Certificate } from '../../api/typings/cert-manager'
import { DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE } from '../../constants'
import { CertManagerTasks } from '../component-installers/cert-manager'
import { createNamespaceTask } from '../installers/common-tasks'

/**
 * Handle setup of the dev workspace operator controller.
 */
export class DevWorkspaceTasks {
  protected kubeHelper: KubeHelper
  protected cheHelper: CheHelper
  protected openShiftHelper: OpenShiftHelper
  protected certManagerTask: CertManagerTasks

  protected devWorkspaceServiceAccount = 'devworkspace-controller-serviceaccount'

  // Roles
  protected devWorkspaceLeaderElectionRole = 'devworkspace-controller-leader-election-role'

  // Cluster Roles
  protected devWorkspaceEditWorkspaceClusterRole = 'devworkspace-controller-edit-workspaces'
  protected devworkspaceProxyClusterRole = 'devworkspace-controller-proxy-role'
  protected devworkspaceClusterRole = 'devworkspace-controller-role'
  protected devWorkspaceViewWorkspaceClusterRole = 'devworkspace-controller-view-workspaces'
  // Cluster Role created by devworkspace pod
  protected devWorkspaceClusterRoleWebhook = 'devworkspace-webhook-server'

  // RoleBindings and ClusterRole Bindings necessary devworkspace
  protected devWorkspaceLeaderElectionRoleBinding = 'devworkspace-controller-leader-election-rolebinding'
  protected devworkspaceProxyClusterRoleBinding = 'devworkspace-controller-proxy-rolebinding'
  protected devWorkspaceRoleBinding = 'devworkspace-controller-rolebinding'

  // Deployment names
  protected deploymentName = 'devworkspace-controller-manager'

  protected devWorkspaceConfigMap = 'devworkspace-controller-configmap'

  protected devWorkspaceCertificate = 'devworkspace-controller-serving-cert'
  protected devWorkspaceCertIssuer = 'devworkspace-controller-selfsigned-issuer'

  // DevWorkspace CRD Names
  protected devWorkspacesCrdName = 'devworkspaces.workspace.devfile.io'
  protected devWorkspaceTemplatesCrdName = 'devworkspacetemplates.workspace.devfile.io'
  protected workspaceRoutingsCrdName = 'workspaceroutings.controller.devfile.io'

  protected webhooksName = 'controller.devfile.io'

  // Web Terminal Operator constants
  protected WTOSubscriptionName = 'web-terminal'
  protected WTONamespace = 'openshift-operators'

  constructor(private readonly flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
    this.openShiftHelper = new OpenShiftHelper()
    this.certManagerTask = new CertManagerTasks({ flags })
  }

  getTemplatePath(ctx: any) {
    if (ctx.isOpenShift) {
      return path.join(this.flags.templates, 'devworkspace', 'deployment', 'openshift', 'objects')
    }
    return path.join(this.flags.templates, 'devworkspace', 'deployment', 'kubernetes', 'objects')
  }

  /**
   * Returns list of tasks which setup dev-workspace.
   */
  getInstallTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      createNamespaceTask(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE, {}),
      {
        title: 'Verify cert-manager installation',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, _task: any) => {
          return new Listr(this.certManagerTask.getDeployCertManagerTasks(flags), ctx.listrOptions)
        }
      },
      // WARNING: Issuer and Certificate should be moved to che-operator side. Depends on issue: https://github.com/eclipse/che/issues/19502
      {
        title: `Create certificate issuer ${this.devWorkspaceCertIssuer}`,
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, task: any) => {
          const certIssuerExist = await this.kubeHelper.isCertificateIssuerExists(this.devWorkspaceCertIssuer, ctx.certManagerK8sApiVersion, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          if (certIssuerExist) {
            task.title = `${task.title}...It already exists.`
            return
          }
          const devWorkspaceIssuerCertFilePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-selfsigned-issuer.Issuer.yaml')
          await this.kubeHelper.createCertificateIssuer(devWorkspaceIssuerCertFilePath, ctx.certManagerK8sApiVersion, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)

          task.title = `${task.title}...Done.`
        }
      },
      {
        title: `Create self signed certificate ${this.devWorkspaceCertificate}`,
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, task: any) => {
          const certExists = await this.kubeHelper.isNamespacedCertificateExists(this.devWorkspaceCertificate, ctx.certManagerK8sApiVersion, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          if (certExists) {
            task.title = `${task.title}...It already exists.`
            return
          }

          const certificateTemplatePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-serving-cert.Certificate.yaml')
          const certifiateYaml = this.kubeHelper.safeLoadFromYamlFile(certificateTemplatePath) as V1Certificate
          await this.kubeHelper.createCheClusterCertificate(certifiateYaml, ctx.certManagerK8sApiVersion)
          task.title = `${task.title}...Done.`
        }
      },
    ]
  }

  /**
   * Returns list of tasks which uninstall dev-workspace.
   */
  getUninstallTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete all DevWorkspace deployments',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllDeployments(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all DevWorkspace services',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllServices(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all DevWorkspace routes',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllIngresses(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all DevWorkspace routes',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.openShiftHelper.deleteAllRoutes(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace configmaps',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.getConfigMap(this.devWorkspaceConfigMap, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteConfigMap(this.devWorkspaceConfigMap, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace ClusterRoleBindings',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.clusterRoleBindingExist(this.devWorkspaceRoleBinding)) {
            await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceRoleBinding)
          }
          if (await this.kubeHelper.clusterRoleBindingExist(this.devworkspaceProxyClusterRoleBinding)) {
            await this.kubeHelper.deleteClusterRoleBinding(this.devworkspaceProxyClusterRoleBinding)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace role',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.roleExist(this.devWorkspaceLeaderElectionRole, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteRole(this.devWorkspaceLeaderElectionRole, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace roleBinding',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.roleBindingExist(this.devWorkspaceLeaderElectionRoleBinding, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceLeaderElectionRoleBinding, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace cluster roles',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceEditWorkspaceClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceEditWorkspaceClusterRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceViewWorkspaceClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceViewWorkspaceClusterRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devworkspaceProxyClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devworkspaceProxyClusterRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devworkspaceClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devworkspaceClusterRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceClusterRoleWebhook)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceClusterRoleWebhook)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace service account',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.serviceAccountExist(this.devWorkspaceServiceAccount, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteServiceAccount(this.devWorkspaceServiceAccount, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace self-signed certificates',
        enabled: async (ctx: any) => !ctx.IsOpenshift,
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.isNamespacedCertificateExists(this.devWorkspaceCertificate, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteNamespacedCertificate(this.devWorkspaceCertificate, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          if (await this.kubeHelper.isCertificateIssuerExists(this.devWorkspaceCertIssuer, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)) {
            await this.kubeHelper.deleteNamespacedIssuer(this.devWorkspaceCertIssuer, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace webhooks',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.isMutatingWebhookConfigurationExists(this.webhooksName)) {
            await this.kubeHelper.deleteMutatingWebhookConfiguration(this.webhooksName)
          }
          if (await this.kubeHelper.isValidatingWebhookConfigurationExists(this.webhooksName)) {
            await this.kubeHelper.deleteValidatingWebhookConfiguration(this.webhooksName)
          }
          task.title = await `${task.title} ...OK`
        }
      },
      {
        title: 'Delete DevWorkspace controller CRDs',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.isCrdV1Exists(this.devWorkspacesCrdName)) {
            await this.kubeHelper.deleteCrdV1(this.devWorkspacesCrdName)
          }
          if (await this.kubeHelper.isCrdV1Exists(this.devWorkspaceTemplatesCrdName)) {
            await this.kubeHelper.deleteCrdV1(this.devWorkspaceTemplatesCrdName)
          }
          if (await this.kubeHelper.isCrdV1Exists(this.workspaceRoutingsCrdName)) {
            await this.kubeHelper.deleteCrdV1(this.workspaceRoutingsCrdName)
          }
          task.title = await `${task.title}...OK`
        }
      },
    ]
  }

}
