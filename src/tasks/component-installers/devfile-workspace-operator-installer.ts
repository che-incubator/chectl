/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { createNamespaceTask } from '../installers/common-tasks'

/**
 * Handle setup of the dev workspace operator controller.
 */
export class DevWorkspaceTasks {
  protected kubeHelper: KubeHelper
  protected cheHelper: CheHelper
  protected openShiftHelper: OpenShiftHelper

  protected devWorkspaceServiceAccount = 'devworkspace-controller'
  protected devWorkspaceRole = 'devworkspace-controller'

  protected devWorkspaceEditWorkspaceClusterRole = 'edit-workspaces'
  protected devWorkspaceViewWorkspaceClusterRole = 'view-workspaces'
  protected devWorkspaceRoleBinding = 'devworkspace-controller'

  protected deploymentName = 'devworkspace-controller'

  constructor(private readonly flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
    this.openShiftHelper = new OpenShiftHelper()

  }

  getTemplatePath() {
    return path.join(this.flags.templates, 'devworkspace')

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
        task: async (_ctx: any, task: any) => {
          const exist = await this.kubeHelper.serviceAccountExist(this.devWorkspaceServiceAccount, this.getNamespace())
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const serviceAccountPath = path.join(this.getTemplatePath(), 'service_account.yaml')
            await this.kubeHelper.createServiceAccountFromFile(serviceAccountPath, this.getNamespace())
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create Cluster Role ${this.devWorkspaceRole}`,
        task: async (_ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devWorkspaceRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const rolePath = path.join(this.getTemplatePath(), 'role.yaml')
            await this.kubeHelper.createClusterRoleFromFile(rolePath, this.devWorkspaceRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devWorkspaceEditWorkspaceClusterRole}`,
        task: async (_ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devWorkspaceEditWorkspaceClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(), 'edit-workspaces-cluster-role.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devWorkspaceEditWorkspaceClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRole ${this.devWorkspaceViewWorkspaceClusterRole}`,
        task: async (_ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleExist(this.devWorkspaceViewWorkspaceClusterRole)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const clusterRolePath = path.join(this.getTemplatePath(), 'view-workspaces-cluster-role.yaml')
            await this.kubeHelper.createClusterRoleFromFile(clusterRolePath, this.devWorkspaceViewWorkspaceClusterRole)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ClusterRoleBinding ${this.devWorkspaceRoleBinding}`,
        task: async (_ctx: any, task: any) => {
          const exist = await this.kubeHelper.clusterRoleBindingExist(this.devWorkspaceRoleBinding)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const roleBindingPath = path.join(this.getTemplatePath(), 'role_binding.yaml')
            const rawYaml = await fs.readFile(roleBindingPath, 'utf-8')
            const clusterRoleBindingYaml: any = yaml.safeLoad(rawYaml)
            clusterRoleBindingYaml.subjects[0].namespace = this.getNamespace()

            await this.kubeHelper.createClusterRoleBindingFrom(clusterRoleBindingYaml)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Create dev workspace CRDs',
        task: async (_ctx: any, task: any) => {
          const exists = await this.kubeHelper.crdExist('devworkspaces.workspace.devfile.io')
          if (exists) {
            task.title = `${task.title}...It already exists.`
            return
          }
          const devfileApiCrdsPath = path.join(flags.templates, 'devfile-api', 'crds')
          const devfileApiCrdsFiles = (await fs.readdir(devfileApiCrdsPath)).map(file => path.join(devfileApiCrdsPath, file))

          const devWorkspaceCrdsPath = path.join(this.getTemplatePath(), 'crds')
          const devWorkspaceCrdsFiles = (await fs.readdir(devWorkspaceCrdsPath)).map(file => path.join(devWorkspaceCrdsPath, file))
          const crdFiles = [...devfileApiCrdsFiles, ...devWorkspaceCrdsFiles]

          await Promise.all(crdFiles.map(async file => {
            if (file.endsWith('.yaml')) {
              return this.kubeHelper.createCrdFromFile(file)
            }
          }))
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Create dev workspace controller ConfigMap',
        task: async (ctx: any, task: any) => {
          const yamlConfigFile = path.join(this.getTemplatePath(), 'controller_config.yaml')
          const rawYaml = await fs.readFile(yamlConfigFile, 'utf-8')
          const configMapYaml: any = yaml.safeLoad(rawYaml)

          const configMapName = 'devworkspace-controller'

          const pluginRegistryURL = await this.cheHelper.chePluginRegistryURL(flags.chenamespace)
          configMapYaml.data['controller.plugin_registry.url'] = pluginRegistryURL
          if (flags.domain) {
            configMapYaml.data['devworkspace.routing.cluster_host_suffix'] = flags.domain
          }

          let webHooksValue = 'false'
          let routingClass = 'basic'
          if (ctx.isOpenShift) {
            routingClass = 'openshift-oauth'
            webHooksValue = 'true'
          }
          configMapYaml.data['controller.webhooks.enabled'] = webHooksValue
          configMapYaml.data['devworkspace.default_routing_class'] = routingClass
          configMapYaml.data['tls.insecure_skip_verify'] = 'true'

          const configMap = await this.kubeHelper.getConfigMap(configMapName, this.getNamespace())
          if (configMap) {
            task.title = `${task.title}...Already Exists. Replacing`
            await this.kubeHelper.replaceNamespacedConfigMap(configMapName, this.getNamespace(), configMapYaml)
          } else {
            await this.kubeHelper.createNamespacedConfigMap(this.getNamespace(), configMapYaml)
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Create dev workspace controller',
        task: async (ctx: any, task: any) => {
          const exists = await this.kubeHelper.deploymentExist('devworkspace-controller', this.getNamespace())
          if (exists) {
            task.title = `${task.title}...It already exists.`
            return
          }
          const yamls: any[] = []
          if (ctx.isOpenShift) {
            const yamlControllerFile = path.join(this.getTemplatePath(), 'os', 'controller.yaml')
            const rawYaml = await fs.readFile(yamlControllerFile, 'utf-8')
            yaml.safeLoadAll(rawYaml, yaml => {
              yamls.push(yaml)
            })
          } else {
            const yamlControllerFile = path.join(this.getTemplatePath(), 'k8s', 'controller.yaml')
            const rawYaml = await fs.readFile(yamlControllerFile, 'utf-8')
            yaml.safeLoadAll(rawYaml, yaml => {
              yamls.push(yaml)
            })
          }
          await Promise.all(yamls.map(async yaml => {
            if (yaml.kind === 'Deployment') {
              // customize devworkspace controller image:
              yaml.spec.template.spec.containers[0].image = flags['dev-workspace-controller-image']
              return this.kubeHelper.createDeploymentFrom(yaml, this.getNamespace())
            }
            if (yaml.kind === 'Service') {
              return this.kubeHelper.createServiceFrom(yaml, this.getNamespace())
            }
          }))

          task.title = `${task.title}...done.`
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
          if (await this.kubeHelper.getConfigMap('devworkspace-controller', this.getNamespace())) {
            await this.kubeHelper.deleteConfigMap('devworkspace-controller', this.getNamespace())
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
          task.title = await `${task.title}...OK`
        }
      },
      {
        title: 'Delete cluster Roles for DevWorkspace controller',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceRole)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceEditWorkspaceClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceEditWorkspaceClusterRole)
          }
          if (await this.kubeHelper.clusterRoleExist(this.devWorkspaceViewWorkspaceClusterRole)) {
            await this.kubeHelper.deleteClusterRole(this.devWorkspaceViewWorkspaceClusterRole)
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
        title: 'Delete DevWorkspace controller CRDs',
        task: async (_ctx: any, task: any) => {
          if (await this.kubeHelper.crdExist('components.controller.devfile.io')) {
            await this.kubeHelper.deleteCrd('components.controller.devfile.io')
          }
          if (await this.kubeHelper.crdExist('devworkspaces.workspace.devfile.io')) {
            await this.kubeHelper.deleteCrd('devworkspaces.workspace.devfile.io')
          }
          if (await this.kubeHelper.crdExist('devworkspacetemplates.workspace.devfile.io')) {
            await this.kubeHelper.deleteCrd('devworkspacetemplates.workspace.devfile.io')
          }
          if (await this.kubeHelper.crdExist('workspaceroutings.controller.devfile.io')) {
            await this.kubeHelper.deleteCrd('workspaceroutings.controller.devfile.io')
          }
          task.title = await `${task.title}...OK`
        }
      },
    ]
  }

}
