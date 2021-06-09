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

import { cli } from 'cli-ux'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { V1Certificate } from '../../api/typings/cert-manager'
import { DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE } from '../../constants'
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

  // DevWorkspace Controller Roles
  protected devWorkspaceLeaderElectionRole = 'devworkspace-controller-leader-election-role'

  // DevWorkspace Controller Role Bindings
  protected devWorkspaceLeaderElectionRoleBinding = 'devworkspace-controller-leader-election-role'

  // DevWorkspace Controller Cluster Roles
  protected devWorkspaceEditWorkspaceClusterRole = 'devworkspace-controller-edit-workspaces'

  protected devworkspaceProxyClusterRole = 'devworkspace-controller-proxy-role'

  protected devworkspaceClusterRole = 'devworkspace-controller-role'

  protected devWorkspaceViewWorkspaceClusterRole = 'devworkspace-controller-view-workspaces'

  protected devWorkspaceClusterRoleWebhook = 'devworkspace-webhook-server'

  // DevWorkspace Controller ClusterRole Bindings
  protected devworkspaceProxyClusterRoleBinding = 'devworkspace-controller-proxy-rolebinding'

  protected devWorkspaceRoleBinding = 'devworkspace-controller-rolebinding'

  // DevWorkspace Che Roles
  protected devWorkspaceCheLeaderElectionRole = 'devworkspace-che-leader-election-role'

  // DevWorkspace Che RoleBindings
  protected devWorkspaceCheLeaderElectionRoleBinding = 'devworkspace-che-leader-election-rolebinding'

  // DevWorkspace Che Cluster Roles
  protected devWorkspaceCheMetricsReader = 'devworkspace-che-metrics-reader'

  protected devWorkspaceCheProxyRole = 'devworkspace-che-proxy-role'

  protected devWorkspaceCheRole = 'devworkspace-che-role'

  // ClusterRoleBindings DevWorkspaceChe
  protected devWorkspaceCheProxyClusterRolebinding = 'devworkspace-che-proxy-rolebinding'

  protected devWorkspaceCheClusterRolebinding = 'devworkspace-che-rolebinding'

  protected devWorkspaceWebhookServerClusterRolebinding = 'devworkspace-webhook-server'

  // Deployment names
  protected deploymentName = 'devworkspace-controller-manager'

  // ConfigMap names
  protected devWorkspaceConfigMap = 'devworkspace-controller-configmap'

  protected devworkspaceCheConfigmap = 'devworkspace-che-configmap'

  protected devWorkspaceCertificate = 'devworkspace-controller-serving-cert'

  protected devWorkspaceCertIssuer = 'devworkspace-controller-selfsigned-issuer'

  // DevWorkspace CRD Names
  protected devWorkspacesCrdName = 'devworkspaces.workspace.devfile.io'

  protected devWorkspaceTemplatesCrdName = 'devworkspacetemplates.workspace.devfile.io'

  protected workspaceRoutingsCrdName = 'devworkspaceroutings.controller.devfile.io'

  protected webhooksName = 'controller.devfile.io'

  // Web Terminal Operator constants
  protected WTOSubscriptionName = 'web-terminal'

  protected WTONamespace = 'openshift-operators'

  // Devworkspace Che operator namespace
  protected devworkspaceCheNamespace = 'devworkspace-che'

  // chemanager k8s object info
  protected cheManagerApiGroupName = 'che.eclipse.org'

  protected cheManagerApiVersionName = 'v1alpha1'

  protected cheManagerCRDName = 'chemanagers.che.eclipse.org'

  protected cheManagersKindPlural = 'chemanagers'

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
        },
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
        },
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
        },
      },
    ]
  }

  /**
   * Returns list of tasks which uninstall dev-workspace.
   */
  getUninstallTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete all DevWorkspace Controller and DevWorkspace Che deployments',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllDeployments(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteAllDeployments(DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE)
          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete all DevWorkspace Controller and DevWorkspace Che services',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllServices(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteAllServices(DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE)
          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete all DevWorkspace Controller and DevWorkspace Che routes',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllIngresses(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete all DevWorkspace Controller and DevWorkspace Che routes',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.openShiftHelper.deleteAllRoutes(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller and DevWorkspace Che configmaps',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteConfigMap(this.devWorkspaceConfigMap, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteConfigMap(this.devworkspaceCheConfigmap, DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller and DevWorkspace Che ClusterRoleBindings',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceRoleBinding)
          await this.kubeHelper.deleteClusterRoleBinding(this.devworkspaceProxyClusterRoleBinding)
          await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceCheProxyClusterRolebinding)
          await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceCheClusterRolebinding)
          await this.kubeHelper.deleteClusterRoleBinding(this.devWorkspaceWebhookServerClusterRolebinding)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller and DevWorkspace Che role',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteRole(this.devWorkspaceLeaderElectionRole, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteRole(this.devWorkspaceCheLeaderElectionRole, DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller and DevWorkspace Che roleBinding',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteRoleBinding(this.devWorkspaceLeaderElectionRoleBinding, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteRoleBinding(this.devWorkspaceCheLeaderElectionRoleBinding, DEFAULT_DEV_WORKSPACE_CHE_NAMESPACE)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller and DevWorkspace Che cluster roles',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceEditWorkspaceClusterRole)
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceViewWorkspaceClusterRole)
          await this.kubeHelper.deleteClusterRole(this.devworkspaceProxyClusterRole)
          await this.kubeHelper.deleteClusterRole(this.devworkspaceClusterRole)
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceClusterRoleWebhook)
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceCheMetricsReader)
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceCheProxyRole)
          await this.kubeHelper.deleteClusterRole(this.devWorkspaceCheRole)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller service account',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteServiceAccount(this.devWorkspaceServiceAccount, DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller self-signed certificates',
        enabled: async (ctx: any) => !ctx.IsOpenshift,
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteNamespacedCertificate(this.devWorkspaceCertificate, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)
          await this.kubeHelper.deleteNamespacedIssuer(this.devWorkspaceCertIssuer, 'v1', DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller we',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteMutatingWebhookConfiguration(this.webhooksName)

          task.title = await `${task.title} ...OK`
        },
      },
      {
        title: 'Delete DevWorkspace Controller CRDs',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteCrd(this.devWorkspacesCrdName)
          await this.kubeHelper.deleteCrd(this.devWorkspaceTemplatesCrdName)
          await this.kubeHelper.deleteCrd(this.workspaceRoutingsCrdName)

          task.title = await `${task.title}...OK`
        },
      },
      {
        title: `Delete the Custom Resource of type ${this.cheManagerCRDName}`,
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteCustomResource(this.devworkspaceCheNamespace, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)

          // Timeout of 20 seconds to see if CR are removed
          for (let index = 0; index < 20; index++) {
            await cli.wait(1000)
            if (!await this.kubeHelper.getCustomResource(this.devworkspaceCheNamespace, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)) {
              task.title = `${task.title}...OK`
              return
            }
          }

          // if chemanager instance still exists then remove finalizers and delete again
          const chemanager = await this.kubeHelper.getCustomResource(this.devworkspaceCheNamespace, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)
          if (chemanager) {
            try {
              await this.kubeHelper.patchCustomResource(chemanager.metadata.name, this.devworkspaceCheNamespace, { metadata: { finalizers: null } }, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)
            } catch (error) {
              if (await this.kubeHelper.getCustomResource(this.devworkspaceCheNamespace, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)) {
                task.title = `${task.title}...OK`
                return // successfully removed
              }
              throw error
            }
          }

          if (!await this.kubeHelper.getCustomResource(this.devworkspaceCheNamespace, this.cheManagerApiGroupName, this.cheManagerApiVersionName, this.cheManagersKindPlural)) {
            task.title = `${task.title}...OK`
          } else {
            task.title = `${task.title}...Failed`
          }
        },
      },
    ]
  }
}
