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

import * as Listr from 'listr'
import { CheHelper } from '../../../api/che'
import { KubeHelper } from '../../../api/kube'
import { DEVFILE_WORKSPACE_API_GROUP, DEVFILE_WORKSPACE_API_VERSION, DEVFILE_WORKSPACE_KIND_PLURAL, DEVFILE_WORKSPACE_ROUTINGS_API_GROUP, DEVFILE_WORKSPACE_ROUTINGS_KIND_PLURAL, DEVFILE_WORKSPACE_ROUTINGS_VERSION } from '../../../constants'

/**
 * Handle setup of the dev workspace operator controller.
 */
export class DevWorkspaceTasks {
  protected kubeHelper: KubeHelper
  protected cheHelper: CheHelper

  // ServiceAccounts
  protected devWorkspaceSAName = 'devworkspace-controller-serviceaccount'
  protected webhookServerSAName = 'devworkspace-webhook-server'

  // Roles and RoleBindings
  protected devWorkspaceLeaderElectionRoleName = 'devworkspace-controller-leader-election-role'
  protected devWorkspaceLeaderElectionRoleBindingName = 'devworkspace-controller-leader-election-rolebinding'
  protected devWorkspaceServiceCertRoleName = 'devworkspace-controller-manager-service-cert'
  protected devWorkspaceServiceCertRoleBindingName = 'devworkspace-controller-manager-service-cert'

  // ClusterRoles and ClusterRoleBindings
  protected devWorkspaceEditWorkspaceClusterRoleName = 'devworkspace-controller-edit-workspaces'
  protected devWorkspaceProxyClusterRoleName = 'devworkspace-controller-proxy-role'
  protected devWorkspaceClusterRoleName = 'devworkspace-controller-role'
  protected devWorkspaceMetricsReaderClusterRoleName = 'devworkspace-controller-metrics-reader'
  protected devWorkspaceViewWorkspaceClusterRoleName = 'devworkspace-controller-view-workspaces'
  protected devWorkspaceProxyClusterRoleBindingName = 'devworkspace-controller-proxy-rolebinding'
  protected devWorkspaceClusterRoleBindingName = 'devworkspace-controller-rolebinding'
  protected webhookServerClusterRoleName = 'devworkspace-webhook-server'
  protected webhookServerClusterRoleBindingName = 'devworkspace-webhook-server'

  // Issuer
  protected devWorkspaceCertificateName = 'devworkspace-controller-serving-cert'
  protected devWorkspaceIssuerName = 'devworkspace-controller-selfsigned-issuer'

  // Secrets
  protected webhookCertSecretName = 'devworkspace-operator-webhook-cert'
  protected devWorkspaceCertSecretName = 'devworkspace-controller-manager-service-cert'
  protected webhookTlsSecretName = 'devworkspace-webhookserver-tls'

  // DevWorkspace CRD Names
  protected devWorkspacesCrdName = 'devworkspaces.workspace.devfile.io'
  protected devWorkspaceTemplatesCrdName = 'devworkspacetemplates.workspace.devfile.io'
  protected devWorkspaceRoutingsCrdName = 'devworkspaceroutings.controller.devfile.io'
  protected devWorkspaceConfigCrdName = 'devworkspaceoperatorconfigs.controller.devfile.io'

  // Deployments
  protected webhookServerDeploymentName = 'devworkspace-webhook-server'
  protected devWorkspaceControllerManagerDeploymentName = 'devworkspace-controller-manager'

  // Services
  protected webhookServiceName = 'devworkspace-webhookserver'
  protected devWorkspaceMetricsServiceName = 'devworkspace-controller-metrics'
  protected devWorkspaceManagerServiceName = 'devworkspace-controller-manager-service'

  // DevWorkspace webhook
  protected webhookConfigurationName = 'controller.devfile.io'

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
  }

  getDeleteTasks(devWorkspaceNamespace: string): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Delete WebhookConfigurations ${this.webhookConfigurationName}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteMutatingWebhookConfiguration(this.webhookConfigurationName)
            await this.kubeHelper.deleteValidatingWebhookConfiguration(this.webhookConfigurationName)
            task.title = `${task.title} ...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete CRDs',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteCrd(this.devWorkspacesCrdName)
            await this.kubeHelper.deleteCrd(this.devWorkspaceTemplatesCrdName)
            await this.kubeHelper.deleteCrd(this.devWorkspaceRoutingsCrdName)
            await this.kubeHelper.deleteCrd(this.devWorkspaceConfigCrdName)
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
            await this.kubeHelper.deleteDeployment(this.devWorkspaceControllerManagerDeploymentName, devWorkspaceNamespace)
            await this.kubeHelper.deleteDeployment(this.webhookServerDeploymentName, devWorkspaceNamespace)
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
            await this.kubeHelper.deleteService(this.webhookServiceName, devWorkspaceNamespace)
            await this.kubeHelper.deleteService(this.devWorkspaceManagerServiceName, devWorkspaceNamespace)
            await this.kubeHelper.deleteService(this.devWorkspaceMetricsServiceName, devWorkspaceNamespace)
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
            await this.kubeHelper.deleteSecret(this.webhookCertSecretName, devWorkspaceNamespace)
            await this.kubeHelper.deleteSecret(this.devWorkspaceCertSecretName, devWorkspaceNamespace)
            await this.kubeHelper.deleteSecret(this.webhookTlsSecretName, devWorkspaceNamespace)
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
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceLeaderElectionRoleBindingName, devWorkspaceNamespace)
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceServiceCertRoleName, devWorkspaceNamespace)
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
            await this.kubeHelper.deleteRole(this.devWorkspaceLeaderElectionRoleName, devWorkspaceNamespace)
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceServiceCertRoleBindingName, devWorkspaceNamespace)
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
            await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceClusterRoleBindingName)
            await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceProxyClusterRoleBindingName)
            await this.kubeHelper.deleteClusterRoleBinding(this.webhookServerClusterRoleBindingName)
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
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceEditWorkspaceClusterRoleName)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceViewWorkspaceClusterRoleName)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceProxyClusterRoleName)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceMetricsReaderClusterRoleName)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceClusterRoleName)
            await this.kubeHelper.deleteClusterRole(this.webhookServerClusterRoleName)
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
            await this.kubeHelper.deleteServiceAccount(this.devWorkspaceSAName, devWorkspaceNamespace)
            await this.kubeHelper.deleteServiceAccount(this.webhookServerSAName, devWorkspaceNamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete Issuer ${this.devWorkspaceIssuerName}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteIssuer(this.devWorkspaceIssuerName, devWorkspaceNamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete Certificate ${this.devWorkspaceCertificateName}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteCertificate(this.devWorkspaceCertificateName, devWorkspaceNamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  getDeleteCRsTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Delete ${DEVFILE_WORKSPACE_API_GROUP}/${DEVFILE_WORKSPACE_API_VERSION} resources`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllCustomResources(DEVFILE_WORKSPACE_API_GROUP, DEVFILE_WORKSPACE_API_VERSION, DEVFILE_WORKSPACE_KIND_PLURAL)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete ${DEVFILE_WORKSPACE_ROUTINGS_API_GROUP}/${DEVFILE_WORKSPACE_ROUTINGS_VERSION} resources`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllCustomResources(DEVFILE_WORKSPACE_ROUTINGS_API_GROUP, DEVFILE_WORKSPACE_ROUTINGS_VERSION, DEVFILE_WORKSPACE_ROUTINGS_KIND_PLURAL)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }
}
