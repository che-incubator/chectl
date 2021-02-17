/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { V1Deployment } from '@kubernetes/client-node'
import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { V1Certificate } from '../../api/typings/cert-manager'
import { safeLoadFromYamlFile } from '../../util'
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

  protected devworkspaceConfigMap = 'devworkspace-controller-configmap'

  protected devworkspaceCertificate = 'devworkspace-controller-serving-cert'
  protected devworkspaceCertIssuer = 'devworkspace-controller-selfsigned-issuer'

  // DevWorkspace CRD Names
  protected devworkspacesCRDName = 'devworkspaces.workspace.devfile.io'
  protected componentsCRDName = 'components.controller.devfile.io'
  protected devworkspacetemplatesCRDName = 'devworkspacetemplates.workspace.devfile.io'
  protected workspaceroutingsCRDName = 'workspaceroutings.controller.devfile.io'

  protected webhooksName = 'controller.devfile.io'

  constructor(private readonly flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
    this.openShiftHelper = new OpenShiftHelper()
    this.certManagerTask = new CertManagerTasks({ flags })
  }

  getTemplatePath(ctx: any) {
    if (ctx.isOpenshift) {
      return path.join(this.flags.templates, 'devworkspace, deployment, openshift, objects')
    }
    return path.join(this.flags.templates, 'devworkspace', 'deployment', 'kubernetes', 'objects')
  }

  getNamespace() {
    return this.flags['dev-workspace-controller-namespace']
  }

  /**
   * Returns list of tasks which setup dev-workspace.
   */
  getInstallTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      createNamespaceTask(this.getNamespace(), {}),
      {
        title: `Create ServiceAccount ${this.devWorkspaceServiceAccount} in namespace ${this.getNamespace()}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.serviceAccountExist(this.devWorkspaceServiceAccount, this.getNamespace())
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const serviceAccountPath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-serviceaccount.ServiceAccount.yaml')
            await this.kubeHelper.createServiceAccountFromFile(serviceAccountPath, this.getNamespace())
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create Role ${this.devWorkspaceLeaderElectionRole} in namespace ${this.getNamespace()}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.roleExist(this.devWorkspaceLeaderElectionRole, this.getNamespace())
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const rolePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-leader-election-role.Role.yaml')
            await this.kubeHelper.createRoleFromFile(rolePath, this.getNamespace())
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devWorkspaceEditWorkspaceClusterRole}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devWorkspaceEditWorkspaceClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-edit-workspaces.ClusterRole.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devWorkspaceEditWorkspaceClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devworkspaceProxyClusterRole}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devworkspaceProxyClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-proxy-role.ClusterRole.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devworkspaceProxyClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devworkspaceClusterRole}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devworkspaceClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-role.ClusterRole.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devworkspaceClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devWorkspaceViewWorkspaceClusterRole}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devWorkspaceViewWorkspaceClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-view-workspaces.ClusterRole.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devWorkspaceViewWorkspaceClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create RoleBinding ${this.devWorkspaceLeaderElectionRoleBinding} in namespace ${this.getNamespace()}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.roleBindingExist(this.devWorkspaceLeaderElectionRoleBinding, this.getNamespace())
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const roleBindingPath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-leader-election-rolebinding.RoleBinding.yaml')
            await this.kubeHelper.createRoleBindingFromFile(roleBindingPath, this.getNamespace())
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRoleBinding ${this.devworkspaceProxyClusterRoleBinding}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleBindingExist(this.devworkspaceProxyClusterRoleBinding)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRoleBindingPath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-proxy-rolebinding.ClusterRoleBinding.yaml')
            const rawYaml = await fs.readFile(clusterRoleBindingPath, 'utf-8')
            const clusterRoleBindingYaml: any = yaml.safeLoad(rawYaml)
            clusterRoleBindingYaml.subjects[0].namespace = this.getNamespace()

            await this.kubeHelper.createClusterRoleBindingFrom(clusterRoleBindingYaml)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRoleBinding ${this.devWorkspaceRoleBinding}`,
        task: async (ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleBindingExist(this.devWorkspaceRoleBinding)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const roleBindingPath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-rolebinding.ClusterRoleBinding.yaml')
            const rawYaml = await fs.readFile(roleBindingPath, 'utf-8')
            const clusterRoleBindingYaml: any = yaml.safeLoad(rawYaml)
            clusterRoleBindingYaml.subjects[0].namespace = this.getNamespace()

            await this.kubeHelper.createClusterRoleBindingFrom(clusterRoleBindingYaml)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Create DevWorkspace Custom Resource Definitions',
        task: async (ctx: any, task: any) => {
          if (!await this.kubeHelper.CRDV1Exist(this.devworkspacesCRDName)) {
            const devworkspaceWorkspaceCRDfile = path.join(this.getTemplatePath(ctx), 'devworkspaces.workspace.devfile.io.CustomResourceDefinition.yaml')
            await this.kubeHelper.createCRDV1FromFile(devworkspaceWorkspaceCRDfile)
          }

          if (!await this.kubeHelper.CRDV1Exist(this.componentsCRDName)) {
            const devworkspaceWorkspaceCRDfile = path.join(this.getTemplatePath(ctx), 'components.controller.devfile.io.CustomResourceDefinition.yaml')
            await this.kubeHelper.createCRDV1FromFile(devworkspaceWorkspaceCRDfile)
          }

          if (!await this.kubeHelper.CRDV1Exist(this.devworkspacetemplatesCRDName)) {
            const devworkspaceWorkspaceCRDfile = path.join(this.getTemplatePath(ctx), 'devworkspacetemplates.workspace.devfile.io.CustomResourceDefinition.yaml')
            await this.kubeHelper.createCRDV1FromFile(devworkspaceWorkspaceCRDfile)
          }

          if (!await this.kubeHelper.CRDV1Exist(this.workspaceroutingsCRDName)) {
            const devworkspaceWorkspaceCRDfile = path.join(this.getTemplatePath(ctx), 'workspaceroutings.controller.devfile.io.CustomResourceDefinition.yaml')
            await this.kubeHelper.createCRDV1FromFile(devworkspaceWorkspaceCRDfile)
          }

          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Create configMap ${this.devworkspaceConfigMap}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kubeHelper.configMapExist(this.devworkspaceConfigMap, this.getNamespace())
          if (exists) {
            task.title = `${task.title}...It already exists.`
            return
          }

          const yamlConfigFile = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-configmap.ConfigMap.yaml')
          const rawYaml = await fs.readFile(yamlConfigFile, 'utf-8')
          const configMapYaml: any = yaml.safeLoad(rawYaml)

          if (flags.domain) {
            configMapYaml.data['devworkspace.routing.cluster_host_suffix'] = flags.domain
          }

          let routingClass = 'basic'
          if (ctx.isOpenShift) {
            routingClass = 'openshift-oauth'
          }
          configMapYaml.data['devworkspace.default_routing_class'] = routingClass
          configMapYaml.data['tls.insecure_skip_verify'] = 'true'

          const configMap = await this.kubeHelper.getConfigMap(this.devworkspaceConfigMap, this.getNamespace())
          if (configMap) {
            task.title = `${task.title}...Already Exists. Replacing`
            await this.kubeHelper.replaceNamespacedConfigMap(this.devworkspaceConfigMap, this.getNamespace(), configMapYaml)
          } else {
            await this.kubeHelper.createNamespacedConfigMap(this.getNamespace(), configMapYaml)
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Create deployment ${this.deploymentName}`,
        task: async (ctx: any, task: any) => {
          const exists = await this.kubeHelper.deploymentExist(this.deploymentName, this.getNamespace())
          if (exists) {
            task.title = `${task.title}...It already exists.`
            return
          }

          const yamlControllerDeploymentFile = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-manager.Deployment.yaml')
          const rawYaml = safeLoadFromYamlFile(yamlControllerDeploymentFile) as V1Deployment
          if (rawYaml.spec && rawYaml.spec.template.spec) {
            rawYaml.spec.template.spec.containers[0].image = flags['dev-workspace-controller-image']
            await this.kubeHelper.createDeploymentFrom(rawYaml, this.getNamespace())
          } else {
            throw new Error('Devworkspace Controller Deployment has incorrect format')
          }

          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Verify cert-manager installation',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, _task: any) => {
          return new Listr(this.certManagerTask.verifyCertManagerDeployment(flags), ctx.listrOptions)
        }
      },
      {
        title: `Create certificate issuer ${this.devworkspaceCertIssuer}`,
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, task: any) => {
          const certIssuerExist = await this.kubeHelper.certificateIssuerExists(this.devworkspaceCertIssuer, ctx.certManagerK8sApiVersion, this.getNamespace())
          if (certIssuerExist) {
            task.title = `${task.title}...It already exists.`
            return
          }
          const devWorkspaceIssuerCertFilePath = path.join(this.getTemplatePath(ctx), 'devworkspace-controller-selfsigned-issuer.Issuer.yaml')
          await this.kubeHelper.createCertificateIssuer(devWorkspaceIssuerCertFilePath, ctx.certManagerK8sApiVersion, this.getNamespace())

          task.title = `${task.title}...Done.`
        }
      },
      {
        title: `Create self-signed certificate ${this.devworkspaceCertificate}`,
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (ctx: any, task: any) => {
          const certExists = await this.kubeHelper.namespacedCertificateExists(this.devworkspaceCertificate, ctx.certManagerK8sApiVersion, this.getNamespace())
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
        title: 'Delete all deployments for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllDeployments(this.getNamespace())
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all services for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllServices(this.getNamespace())
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all ingresses for DevWorkspace controller',
        enabled: (ctx: any) => !ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.deleteAllIngresses(this.getNamespace())
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete all routes for DevWorkspace controller',
        enabled: (ctx: any) => ctx.isOpenShift,
        task: async (_ctx: any, task: any) => {
          await this.openShiftHelper.deleteAllRoutes(this.getNamespace())
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete configmaps for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.getConfigMap(this.devworkspaceConfigMap, this.getNamespace())) {
            await this.kubeHelper.deleteConfigMap(this.devworkspaceConfigMap, this.getNamespace())
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete ClusterRoleBinding for DevWorkspace controller',
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
        title: 'Delete roles for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.roleExist(this.devWorkspaceLeaderElectionRole, this.getNamespace())) {
            await this.kubeHelper.deleteRole(this.devWorkspaceLeaderElectionRole, this.getNamespace())
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete roles for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.roleBindingExist(this.devWorkspaceLeaderElectionRoleBinding, this.getNamespace())) {
            await this.kubeHelper.deleteRoleBinding(this.devWorkspaceLeaderElectionRoleBinding, this.getNamespace())
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete cluster Roles for DevWorkspace controller',
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
        title: 'Delete service account for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.serviceAccountExist(this.devWorkspaceServiceAccount, this.getNamespace())) {
            await this.kubeHelper.deleteServiceAccount(this.devWorkspaceServiceAccount, this.getNamespace())
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete DevWorkspace self-signed certificates',
        enabled: async (ctx: any) => !ctx.IsOpenshift,
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.namespacedCertificateExists(this.devworkspaceCertificate, 'v1', this.getNamespace())) {
            await this.kubeHelper.deleteNamespacedCertificate(this.devworkspaceCertificate, 'v1', this.getNamespace())
          }
          if (await this.kubeHelper.certificateIssuerExists(this.devworkspaceCertIssuer, 'v1', this.getNamespace())) {
            await this.kubeHelper.deleteNamespacedIssuer(this.devworkspaceCertIssuer, 'v1', this.getNamespace())
          }
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete Devworkspace webhooks',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.mutatingWebhookConfigurationExist(this.webhooksName)) {
            await this.kubeHelper.deleteMutatingWebhookConfiguration(this.webhooksName)
          }
          if (await this.kubeHelper.validatingWebhookConfigurationExist(this.webhooksName)) {
            await this.kubeHelper.deleteValidatingWebhookConfiguration(this.webhooksName)
          }
          task.title = await `${task.title} ...OK`
        }
      },
      {
        title: 'Delete DevWorkspace controller CRDs',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.CRDV1Exist(this.componentsCRDName)) {
            await this.kubeHelper.deleteCRDV1(this.componentsCRDName)
          }
          if (await this.kubeHelper.CRDV1Exist(this.devworkspacesCRDName)) {
            await this.kubeHelper.deleteCRDV1(this.devworkspacesCRDName)
          }
          if (await this.kubeHelper.CRDV1Exist(this.devworkspacetemplatesCRDName)) {
            await this.kubeHelper.deleteCRDV1(this.devworkspacetemplatesCRDName)
          }
          if (await this.kubeHelper.CRDV1Exist(this.workspaceroutingsCRDName)) {
            await this.kubeHelper.deleteCRDV1(this.workspaceroutingsCRDName)
          }
          task.title = await `${task.title}...OK`
        }
      },
    ]
  }

}
