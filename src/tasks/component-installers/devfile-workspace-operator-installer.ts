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
import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE, DEVFILE_WORKSPACE_API_GROUP, DEVFILE_WORKSPACE_API_VERSION, DEVFILE_WORKSPACE_KIND_PLURAL, DEVFILE_WORKSPACE_ROUTINGS_API_GROUP, DEVFILE_WORKSPACE_ROUTINGS_KIND_PLURAL, DEVFILE_WORKSPACE_ROUTINGS_VERSION } from '../../constants'
import { CertManagerTasks } from '../component-installers/cert-manager'

/**
 * Handle setup of the dev workspace operator controller.
 */
export class DevWorkspaceTasks {
  protected kubeHelper: KubeHelper

  protected cheHelper: CheHelper

  protected openShiftHelper: OpenShiftHelper

  protected certManagerTask: CertManagerTasks

  protected devWorkspaceServiceAccount = 'devworkspace-controller-serviceaccount'
  protected devWorkspaceWebhookServiceAccount = 'devworkspace-webhook-server'

  // DevWorkspace Controller Roles
  protected devWorkspaceLeaderElectionRole = 'devworkspace-controller-leader-election-role'

  // DevWorkspace Controller Role Bindings
  protected devWorkspaceLeaderElectionRoleBinding = 'devworkspace-controller-leader-election-role'

  // DevWorkspace Controller Cluster Roles
  protected devWorkspaceEditWorkspaceClusterRole = 'devworkspace-controller-edit-workspaces'

  protected devWorkspaceProxyClusterRole = 'devworkspace-controller-proxy-role'

  protected devworkspaceClusterRole = 'devworkspace-controller-role'

  protected devWorkspaceMetricsClusterRole = 'devworkspace-controller-metrics-reader'

  protected devWorkspaceViewWorkspaceClusterRole = 'devworkspace-controller-view-workspaces'

  protected devWorkspaceClusterRoleWebhook = 'devworkspace-webhook-server'

  // DevWorkspace Controller ClusterRole Bindings
  protected devworkspaceProxyClusterRoleBinding = 'devworkspace-controller-proxy-rolebinding'

  protected devWorkspaceRoleBinding = 'devworkspace-controller-rolebinding'

  protected devWorkspaceWebhookServerClusterRole = 'devworkspace-webhook-server'

  // Deployment names
  protected deploymentName = 'devworkspace-controller-manager'
  protected deploymentWebhookName = 'devworkspace-webhook-server'

  // Services
  protected serviceWebhookName = 'devworkspace-webhookserver'

  // ConfigMap names
  protected devWorkspaceConfigMap = 'devworkspace-controller-configmap'

  protected devWorkspaceCertificate = 'devworkspace-controller-serving-cert'

  protected devWorkspaceCertIssuer = 'devworkspace-controller-selfsigned-issuer'

  // DevWorkspace CRD Names
  protected devWorkspacesCrdName = 'devworkspaces.workspace.devfile.io'

  protected devWorkspaceTemplatesCrdName = 'devworkspacetemplates.workspace.devfile.io'

  protected workspaceRoutingsCrdName = 'devworkspaceroutings.controller.devfile.io'

  protected devWorkspaceConfigCrdName = 'devworkspaceoperatorconfigs.controller.devfile.io'

  protected webhooksName = 'controller.devfile.io'

  // Web Terminal Operator constants
  protected WTOSubscriptionName = 'web-terminal'

  protected WTONamespace = 'openshift-operators'

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
    this.openShiftHelper = new OpenShiftHelper()
    this.certManagerTask = new CertManagerTasks({ flags })
  }

  /**
   * Returns list of tasks which uninstall dev-workspace operator.
   */
  deleteResourcesTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete all Dev Workspace Controller deployments',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllDeployments(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete all Dev Workspace Controller services',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllServices(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete all Dev Workspace Controller routes',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllIngresses(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete all Dev Workspace Controller routes',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          try {
            await this.openShiftHelper.deleteAllRoutes(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller configmaps',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteConfigMap(this.devWorkspaceConfigMap, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller ClusterRoleBindings',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceRoleBinding)
            await this.kubeHelper.deleteClusterRoleBinding(this.devworkspaceProxyClusterRoleBinding)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller role',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteRole(this.devWorkspaceLeaderElectionRole, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller roleBinding',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceLeaderElectionRoleBinding, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller cluster roles',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceEditWorkspaceClusterRole)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceViewWorkspaceClusterRole)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceProxyClusterRole)
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceMetricsClusterRole)
            await this.kubeHelper.deleteClusterRole(this.devworkspaceClusterRole)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller service account',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteServiceAccount(this.devWorkspaceServiceAccount, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Controller self-signed certificates',
        enabled: async (ctx: any) => !ctx.IsOpenshift,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteCertificate(this.devWorkspaceCertificate, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            await this.kubeHelper.deleteIssuer(this.devWorkspaceCertIssuer, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace Operator Namespace',
        task: async (_ctx: any, task: any) => {
          try {
            const namespaceExist = await this.kubeHelper.getNamespace(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            if (namespaceExist) {
              await this.kubeHelper.deleteNamespace(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
            }
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  deleteDevOperatorCRsAndCRDsTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Delete ${DEVFILE_WORKSPACE_API_GROUP}/${DEVFILE_WORKSPACE_API_VERSION} resources`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteAllCustomResources(DEVFILE_WORKSPACE_API_GROUP, DEVFILE_WORKSPACE_API_VERSION, DEVFILE_WORKSPACE_KIND_PLURAL)
            task.title = `${task.title}...[Deleted]`
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
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete All Dev Workspace CRD',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteCrd(this.devWorkspacesCrdName)
            await this.kubeHelper.deleteCrd(this.devWorkspaceTemplatesCrdName)
            await this.kubeHelper.deleteCrd(this.workspaceRoutingsCrdName)
            await this.kubeHelper.deleteCrd(this.devWorkspaceConfigCrdName)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  deleteDevWorkspaceWebhooksTasks(namespace: string): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete Dev Workspace webhook deployment',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteDeployment(this.deploymentWebhookName, namespace)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace webhook service',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteService(this.serviceWebhookName, namespace)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace webhook Cluster RoleBinding',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceWebhookServerClusterRole)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace webhook Cluster Role',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceWebhookServerClusterRole)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace webhooks service account',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteServiceAccount(this.devWorkspaceWebhookServiceAccount, namespace)
            task.title = `${task.title}...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace webhooks configurations',
        enabled: ctx => !ctx.isOLMStableDevWorkspaceOperator && !ctx.devWorkspacesPresent,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteMutatingWebhookConfiguration(this.webhooksName)
            await this.kubeHelper.deleteValidatingWebhookConfiguration(this.webhooksName)
            task.title = `${task.title} ...[Deleted]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }
}
