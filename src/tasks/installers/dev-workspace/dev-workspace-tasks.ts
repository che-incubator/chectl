/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
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
import {KubeClient} from '../../../api/kube-client'
import {CommonTasks} from '../../common-tasks'
import {
  CheCtlContext,
  CliContext,
  DevWorkspaceContext,
  InfrastructureContext,
} from '../../../context'
import {DevWorkspace} from './dev-workspace'
import * as path from 'node:path'

export namespace DevWorkspacesTasks {
  export function getDeleteWebhooksTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    return CommonTasks.getDeleteResourcesTask('Delete Webhooks',
      [
        () => kubeHelper.deleteMutatingWebhookConfiguration(DevWorkspace.WEBHOOK),
        () => kubeHelper.deleteValidatingWebhookConfiguration(DevWorkspace.WEBHOOK),
      ])
  }

  export function getDeleteCustomResourcesTasks(): Listr.ListrTask<any>[] {
    const kubeHelper = KubeClient.getInstance()
    return [
      CommonTasks.getDeleteResourcesTask(`Delete ${DevWorkspace.DEV_WORKSPACES_CRD} resources`, [() => kubeHelper.deleteAllCustomResourcesAndCrd(DevWorkspace.DEV_WORKSPACES_CRD, DevWorkspace.WORKSPACE_API_GROUP, DevWorkspace.WORKSPACE_API_VERSION, DevWorkspace.DEV_WORKSPACES_KIND)]),
      CommonTasks.getDeleteResourcesTask(`Delete ${DevWorkspace.DEV_WORKSPACES_TEMPLATES_CRD} resources`, [() => kubeHelper.deleteAllCustomResourcesAndCrd(DevWorkspace.DEV_WORKSPACES_TEMPLATES_CRD, DevWorkspace.WORKSPACE_API_GROUP, DevWorkspace.WORKSPACE_API_VERSION, DevWorkspace.DEV_WORKSPACE_TEMPLATES_KIND)]),
      CommonTasks.getDeleteResourcesTask(`Delete ${DevWorkspace.DEV_WORKSPACE_ROUTINGS_CRD} resources`, [() => kubeHelper.deleteAllCustomResourcesAndCrd(DevWorkspace.DEV_WORKSPACE_ROUTINGS_CRD, DevWorkspace.CONTROLLER_API_GROUP, DevWorkspace.CONTROLLER_API_VERSION, DevWorkspace.DEV_WORKSPACE_ROUTINGS_KIND)]),
      CommonTasks.getDeleteResourcesTask(`Delete ${DevWorkspace.DEV_WORKSPACE_OPERATOR_CONFIGS_CRD} resources`, [() => kubeHelper.deleteAllCustomResourcesAndCrd(DevWorkspace.DEV_WORKSPACE_OPERATOR_CONFIGS_CRD, DevWorkspace.CONTROLLER_API_GROUP, DevWorkspace.CONTROLLER_API_VERSION, DevWorkspace.DEV_WORKSPACE_OPERATOR_CONFIGS_PLURAL)]),
    ]
  }

  export function getDeleteServicesTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()

    const deleteResources = []
    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      deleteResources.push(() => kubeHelper.deleteService(DevWorkspace.DEV_WORKSPACE_CONTROLLER_SERVICE, ctx[DevWorkspaceContext.NAMESPACE]), () => kubeHelper.deleteService(DevWorkspace.DEV_WORKSPACE_CONTROLLER_METRICS_SERVICE, ctx[DevWorkspaceContext.NAMESPACE]))
    }

    deleteResources.push(() => kubeHelper.deleteService(DevWorkspace.WEBHOOK_SERVER_SERVICE, ctx[DevWorkspaceContext.NAMESPACE]))
    return CommonTasks.getDeleteResourcesTask('Delete Services', deleteResources)
  }

  export async function getDeleteWorkloadsTask(): Promise<Listr.ListrTask<any>> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()

    const deleteResources = []
    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      deleteResources.push(() => kubeHelper.deleteDeployment(DevWorkspace.DEV_WORKSPACE_CONTROLLER_DEPLOYMENT, ctx[DevWorkspaceContext.NAMESPACE]), () => kubeHelper.deleteSecret(DevWorkspace.WEBHOOK_SERVER_CERT, ctx[DevWorkspaceContext.NAMESPACE]), () => kubeHelper.deleteSecret(DevWorkspace.DEV_WORKSPACE_CONTROLLER_SERVICE_CERT, ctx[DevWorkspaceContext.NAMESPACE]))
    }

    deleteResources.push(() => kubeHelper.deleteDeployment(DevWorkspace.WEBHOOK_SERVER_DEPLOYMENT, ctx[DevWorkspaceContext.NAMESPACE]), () => kubeHelper.deleteSecret(DevWorkspace.WEBHOOK_SERVER_TLS, ctx[DevWorkspaceContext.NAMESPACE]))

    // Delete leader election related resources
    const cms = await kubeHelper.listConfigMaps(ctx[DevWorkspaceContext.NAMESPACE])
    for (const cm of cms) {
      const configMapName = cm.metadata!.name!
      if (configMapName.endsWith('devfile.io')) {
        deleteResources.push(() => kubeHelper.deleteConfigMap(configMapName, ctx[DevWorkspaceContext.NAMESPACE]), () => kubeHelper.deleteLease(configMapName, ctx[DevWorkspaceContext.NAMESPACE]))
      }
    }

    return CommonTasks.getDeleteResourcesTask('Delete Workloads', deleteResources)
  }

  export function getDeleteRbacTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()

    return CommonTasks.getDeleteResourcesTask('Delete RBAC',
      [
        () => kubeHelper.deleteRole(DevWorkspace.DEV_WORKSPACE_LEADER_ELECTION_ROLE, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteRoleBinding(DevWorkspace.DEV_WORKSPACE_LEADER_ELECTION_ROLE_BINDING, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteRoleBinding(DevWorkspace.DEV_WORKSPACE_SERVICE_CERT_ROLE, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteRoleBinding(DevWorkspace.DEV_WORKSPACE_SERVICE_CERT_ROLE_BINDING, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteRoleBinding(DevWorkspace.DEV_WORKSPACE_SERVICE_AUTH_READER_ROLE_BINDING, 'kube-system'),

        () => kubeHelper.deleteClusterRoleBinding(DevWorkspace.DEV_WORKSPACES_CLUSTER_ROLE_BINDING),
        () => kubeHelper.deleteClusterRoleBinding(DevWorkspace.DEV_WORKSPACES_PROXY_CLUSTER_ROLE_BINDING),
        () => kubeHelper.deleteClusterRoleBinding(DevWorkspace.DEV_WORKSPACES_WEBHOOK_CLUSTER_ROLE_BINDING),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACE_EDIT_WORKSPACES_CLUSTER_ROLE),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACES_VIEW_WORKSPACES_CLUSTER_ROLE),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACE_PROXY_CLUSTER_ROLE),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACES_METRICS_CLUSTER_ROLE),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACES_CLUSTER_ROLE),
        () => kubeHelper.deleteClusterRole(DevWorkspace.DEV_WORKSPACES_WEBHOOK_CLUSTER_ROLE),

        () => kubeHelper.deleteServiceAccount(DevWorkspace.DEV_WORKSPACE_CONTROLLER_SERVICE_ACCOUNT, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteServiceAccount(DevWorkspace.WEBHOOK_SERVER_SERVICE_ACCOUNT, ctx[DevWorkspaceContext.NAMESPACE]),
      ])
  }

  export function getDeleteCertificatesTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()

    return CommonTasks.getDeleteResourcesTask('Delete Certificates',
      [
        () => kubeHelper.deleteIssuer(DevWorkspace.DEV_WORKSPACE_CONTROLLER_ISSUER, ctx[DevWorkspaceContext.NAMESPACE]),
        () => kubeHelper.deleteCertificate(DevWorkspace.DEV_WORKSPACE_CONTROLLER_CERTIFICATE, ctx[DevWorkspaceContext.NAMESPACE]),
      ])
  }

  export function getCreateOrUpdateDevWorkspaceTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    return {
      title: `${isCreateOnly ? 'Create' : 'Update'} ${DevWorkspace.PRODUCT_NAME} operator resources`,
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        await kubeHelper.applyResource(`${path.normalize(ctx[CliContext.CLI_DEV_WORKSPACE_OPERATOR_RESOURCES_DIR])}/kubernetes/combined.yaml`)
        task.title = `${task.title}...[${isCreateOnly ? 'Created' : 'Updated'}]`
      },
    }
  }

  export function getWaitDevWorkspaceTask(): Listr.ListrTask<any> {
    return {
      title: `Wait for ${DevWorkspace.PRODUCT_NAME} operator ready`,
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        await kubeHelper.waitForPodReady('app.kubernetes.io/name=devworkspace-controller', ctx[DevWorkspaceContext.NAMESPACE])
        await kubeHelper.waitForPodReady('app.kubernetes.io/name=devworkspace-webhook-server', ctx[DevWorkspaceContext.NAMESPACE], true)
        task.title = `${task.title}...[OK]`
      },
    }
  }
}
