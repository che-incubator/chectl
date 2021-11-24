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

import { AdmissionregistrationV1Api, ApiextensionsV1Api, ApiextensionsV1beta1Api, ApisApi, AppsV1Api, AuthorizationV1Api, BatchV1Api, CoreV1Api, CustomObjectsApi, KubeConfig, Log, NetworkingV1Api, PortForward, RbacAuthorizationV1Api, V1ClusterRole, V1ClusterRoleBinding, V1ClusterRoleBindingList, V1ConfigMap, V1ConfigMapEnvSource, V1Container, V1ContainerStateTerminated, V1ContainerStateWaiting, V1Deployment, V1DeploymentList, V1DeploymentSpec, V1EnvFromSource, V1Ingress, V1IngressList, V1Job, V1JobSpec, V1LabelSelector, V1MutatingWebhookConfiguration, V1Namespace, V1NamespaceList, V1ObjectMeta, V1PersistentVolumeClaimList, V1Pod, V1PodCondition, V1PodList, V1PodSpec, V1PodTemplateSpec, V1PolicyRule, V1Role, V1RoleBinding, V1RoleBindingList, V1RoleList, V1RoleRef, V1Secret, V1SelfSubjectAccessReview, V1SelfSubjectAccessReviewSpec, V1Service, V1ServiceAccount, V1ServiceList, V1Subject, Watch } from '@kubernetes/client-node'
import { Cluster, Context } from '@kubernetes/client-node/dist/config_types'
import axios, { AxiosRequestConfig } from 'axios'
import { cli } from 'cli-ux'
import * as execa from 'execa'
import * as fs from 'fs'
import * as https from 'https'
import { merge } from 'lodash'
import * as net from 'net'
import { Writable } from 'stream'
import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL, CHE_CLUSTER_KIND_PLURAL, CHE_CLUSTER_RESTORE_KIND_PLURAL, DEFAULT_CHE_TLS_SECRET_NAME, DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT, DEFAULT_K8S_POD_WAIT_TIMEOUT, OLM_STABLE_CHANNEL_NAME } from '../constants'
import { base64Encode, getClusterClientCommand, getImageNameAndTag, isKubernetesPlatformFamily, newError, safeLoadFromYamlFile } from '../util'
import { ChectlContext, OLM } from './context'
import { V1CheClusterBackup, V1CheClusterRestore } from './types/backup-restore-crds'

import { V1Certificate } from './types/cert-manager'
import { CatalogSource, ClusterServiceVersion, ClusterServiceVersionList, InstallPlan, OperatorGroup, PackageManifest, Subscription } from './types/olm'
import { IdentityProvider, OAuth } from './types/openshift'
import { VersionHelper } from './version'

const AWAIT_TIMEOUT_S = 30

export class KubeHelper {
  public readonly kubeConfig

  readonly API_EXTENSIONS_V1BETA1 = 'apiextensions.k8s.io/v1beta1'

  podWaitTimeout: number
  podDownloadImageTimeout: number
  podReadyTimeout: number
  podErrorRecheckTimeout: number

  constructor(flags?: any) {
    this.podWaitTimeout = (flags && flags.k8spodwaittimeout) ? parseInt(flags.k8spodwaittimeout, 10) : DEFAULT_K8S_POD_WAIT_TIMEOUT
    this.podReadyTimeout = (flags && flags.k8spodreadytimeout) ? parseInt(flags.k8spodreadytimeout, 10) : DEFAULT_K8S_POD_WAIT_TIMEOUT
    this.podDownloadImageTimeout = (flags && flags.k8spoddownloadimagetimeout) ? parseInt(flags.k8spoddownloadimagetimeout, 10) : DEFAULT_K8S_POD_WAIT_TIMEOUT
    this.podErrorRecheckTimeout = (flags && flags.spoderrorrechecktimeout) ? parseInt(flags.spoderrorrechecktimeout, 10) : DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT
    this.kubeConfig = new KubeConfig()
    this.kubeConfig.loadFromDefault()
  }

  async createNamespace(namespaceName: string, labels: any): Promise<void> {
    const namespaceObject = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        labels,
        name: namespaceName,
      },
    }

    return this.createNamespaceFromObj(namespaceObject)
  }

  async createNamespaceFromFile(filePath: string): Promise<void> {
    const namespace = this.safeLoadFromYamlFile(filePath) as V1Namespace
    return this.createNamespaceFromObj(namespace)
  }

  async createNamespaceFromObj(namespace: V1Namespace): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.createNamespace(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Wait until workspace is in 'Active` state.
   */
  async waitNamespaceActive(name: string, intervalMs = 500, timeoutMs = 60000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const namespace = await this.getNamespace(name)
      if (namespace && namespace.status && namespace.status.phase && namespace.status.phase === 'Active') {
        return
      }
      await cli.wait(intervalMs)
    }

    throw new Error(`Namespace '${name}' is not in 'Active' phase.`)
  }

  async deleteAllServices(namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedService(namespace)
      if (res && res.response && res.response.statusCode === 200) {
        const serviceList = res.body
        await serviceList.items.forEach(async service => {
          try {
            await k8sApi.deleteNamespacedService(service.metadata!.name!, namespace)
          } catch (error) {
            if (error.response.statusCode !== 404) {
              throw error
            }
          }
        })
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async applyResource(yamlPath: string, opts = ''): Promise<void> {
    const command = `kubectl apply -f ${yamlPath} ${opts}`
    await execa(command, { timeout: 30000, shell: true })
  }

  async getServicesBySelector(labelSelector = '', namespace = ''): Promise<V1ServiceList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService(namespace, 'true', undefined, undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_SERVICES')
  }

  async waitForService(selector: string, namespace = '', intervalMs = 500, timeoutMs = 30000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const currentServices = await this.getServicesBySelector(selector, namespace)
      if (currentServices && currentServices.items.length > 0) {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to waiting for service ${timeoutMs}`)
  }

  async isServiceAccountExist(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedServiceAccount(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceAccount(name = '', namespace = '') {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    const sa = new V1ServiceAccount()
    sa.metadata = new V1ObjectMeta()
    sa.metadata.name = name
    sa.metadata.namespace = namespace
    try {
      return await k8sCoreApi.createNamespacedServiceAccount(namespace, sa)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitServiceAccount(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/api/v1/namespaces/${namespace}/serviceaccounts`, {},
        (_phase: string, obj: any) => {
          const serviceAccount = obj as V1ServiceAccount

          // Filter other service accounts in the given namespace
          if (serviceAccount && serviceAccount.metadata && serviceAccount.metadata.name === name) {
            // The service account is present, stop watching
            if (request) {
              request.abort()
            }
            // Release awaiter
            resolve()
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      // Automatically stop watching after timeout
      const timeoutHandler = setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${name}" service account.`)
      }, timeout * 1000)

      // Request service account, for case if it is already exist
      const serviceAccount = await this.getSecret(name, namespace)
      if (serviceAccount) {
        // Stop watching
        request.abort()
        clearTimeout(timeoutHandler)

        // Relese awaiter
        resolve()
      }
    })
  }

  async deleteServiceAccount(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedServiceAccount(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createServiceAccountFromFile(filePath: string, namespace: string) {
    const yamlServiceAccount = this.safeLoadFromYamlFile(filePath) as V1ServiceAccount
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.createNamespacedServiceAccount(namespace, yamlServiceAccount)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceServiceAccountFromFile(filePath: string, namespace = '') {
    const yamlServiceAccount = this.safeLoadFromYamlFile(filePath) as V1ServiceAccount
    if (!yamlServiceAccount || !yamlServiceAccount.metadata || !yamlServiceAccount.metadata.name) {
      throw new Error(`Service account read from ${filePath} must have name specified.`)
    }
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.replaceNamespacedServiceAccount(yamlServiceAccount.metadata.name, namespace, yamlServiceAccount)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleExist(name = '', namespace = ''): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readNamespacedRole(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async isClusterRoleExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRole(name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getClusterRole(name: string): Promise<V1ClusterRole | undefined> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readClusterRole(name)
      return body
    } catch {
      return
    }
  }

  async getRole(name: string, namespace: string): Promise<V1Role | undefined> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.readNamespacedRole(name, namespace)
      return res.body
    } catch (e) {
      if (e.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async listRoles(namespace: string): Promise<V1RoleList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listNamespacedRole(namespace)
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createRoleFromObj(yamlRole: V1Role, namespace: string) {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.createNamespacedRole(namespace, yamlRole)
      return res.response.statusCode
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createRoleFromFile(filePath: string, namespace: string) {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1Role
    return this.createRoleFromObj(yamlRole, namespace)
  }

  async replaceRoleFromObj(yamlRole: V1Role, namespace: string) {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)

    if (!yamlRole.metadata || !yamlRole.metadata.name) {
      throw new Error('Role object requires name')
    }
    try {
      const res = await k8sRbacAuthApi.replaceNamespacedRole(yamlRole.metadata.name, namespace, yamlRole)
      return res.response.statusCode
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleFromFile(filePath: string, namespace: string) {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1Role
    return this.replaceRoleFromObj(yamlRole, namespace)
  }

  async listClusterRoles(): Promise<V1RoleList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listClusterRole()
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleFromObj(yamlClusterRole: V1ClusterRole, clusterRoleName?: string) {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    if (!yamlClusterRole.metadata) {
      yamlClusterRole.metadata = {}
    }

    if (clusterRoleName) {
      yamlClusterRole.metadata.name = clusterRoleName
    } else if (!yamlClusterRole.metadata.name) {
      throw new Error('Role name is not specified')
    }
    try {
      const res = await k8sRbacAuthApi.createClusterRole(yamlClusterRole)
      return res.response.statusCode
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleFromFile(filePath: string, clusterRoleName?: string) {
    const yamlClusterRole = this.safeLoadFromYamlFile(filePath) as V1ClusterRole
    return this.createClusterRoleFromObj(yamlClusterRole, clusterRoleName)
  }

  async replaceClusterRoleFromObj(yamlClusterRole: V1ClusterRole, clusterRoleName?: string) {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    if (!yamlClusterRole.metadata) {
      yamlClusterRole.metadata = {}
    }

    if (clusterRoleName) {
      yamlClusterRole.metadata.name = clusterRoleName
    } else if (!yamlClusterRole.metadata.name) {
      throw new Error('Role name is not specified')
    }
    try {
      const res = await k8sRbacAuthApi.replaceClusterRole(yamlClusterRole.metadata.name, yamlClusterRole)
      return res.response.statusCode
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleFromFile(filePath: string, clusterRoleName?: string) {
    const yamlClusterRole = this.safeLoadFromYamlFile(filePath) as V1ClusterRole
    return this.replaceClusterRoleFromObj(yamlClusterRole, clusterRoleName)
  }

  async addClusterRoleRule(name: string, apiGroups: string[], resources: string[], verbs: string[]): Promise<V1ClusterRole | undefined> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    const clusterRole = await this.getClusterRole(name)
    if (clusterRole) {
      // Clean up metadata, otherwise replace role call will fail
      clusterRole.metadata = {}
      clusterRole.metadata.name = name

      // Add new policy
      const additionaRule = new V1PolicyRule()
      additionaRule.apiGroups = apiGroups
      additionaRule.resources = resources
      additionaRule.verbs = verbs
      if (clusterRole.rules) {
        clusterRole.rules.push(additionaRule)
      }

      try {
        const { body } = await k8sRbacAuthApi.replaceClusterRole(name, clusterRole)
        return body
      } catch {
        return
      }
    }
  }

  async deleteRole(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteNamespacedRole(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPodListByLabel(namespace: string, labelSelector: string): Promise<V1Pod[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body: podList } = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector)

      return podList.items
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteClusterRole(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listRoleBindings(namespace: string): Promise<V1RoleBindingList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listNamespacedRoleBinding(namespace)
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleBindingExist(name = '', namespace = ''): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRoleBinding(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isMutatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readMutatingWebhookConfiguration(name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getMutatingWebhookConfiguration(name: string): Promise<V1MutatingWebhookConfiguration> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const res = await k8sAdmissionApi.readMutatingWebhookConfiguration(name)
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isValidatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readValidatingWebhookConfiguration(name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deleteValidatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteValidatingWebhookConfiguration(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteMutatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteMutatingWebhookConfiguration(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listClusterRoleBindings(labelSelector?: string, fieldSelector?: string): Promise<V1ClusterRoleBindingList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listClusterRoleBinding(undefined, undefined, undefined, fieldSelector, labelSelector)
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isClusterRoleBindingExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRoleBinding(name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createAdminRoleBinding(name = '', serviceAccount = '', namespace = '') {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    const rb = new V1RoleBinding()
    rb.metadata = new V1ObjectMeta()
    rb.metadata.name = name
    rb.metadata.namespace = namespace
    rb.roleRef = new V1RoleRef()
    rb.roleRef.kind = 'ClusterRole'
    rb.roleRef.name = 'admin'
    const subject = new V1Subject()
    subject.kind = 'ServiceAccount'
    subject.name = serviceAccount
    subject.namespace = namespace
    rb.subjects = [subject]
    try {
      return await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, rb)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createRoleBindingFromObj(yamlRoleBinding: V1RoleBinding, namespace: string): Promise<V1RoleBinding> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const response = await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, yamlRoleBinding)
      return response.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createRoleBindingFromFile(filePath: string, namespace: string): Promise<V1RoleBinding> {
    const yamlRoleBinding = this.safeLoadFromYamlFile(filePath) as V1RoleBinding
    return this.createRoleBindingFromObj(yamlRoleBinding, namespace)
  }

  async replaceRoleBindingFromObj(yamlRoleBinding: V1RoleBinding, namespace: string): Promise<V1RoleBinding> {
    if (!yamlRoleBinding.metadata || !yamlRoleBinding.metadata.name) {
      throw new Error('RoleBinding object requires name')
    }

    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const response = await k8sRbacAuthApi.replaceNamespacedRoleBinding(yamlRoleBinding.metadata.name, namespace, yamlRoleBinding)
      return response.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBindingFromFile(filePath: string, namespace: string): Promise<V1RoleBinding> {
    const yamlRoleBinding = this.safeLoadFromYamlFile(filePath) as V1RoleBinding
    return this.replaceRoleBindingFromObj(yamlRoleBinding, namespace)
  }

  async createClusterRoleBindingRoleFromFile(filePath: string): Promise<void> {
    const clusterRoleBinding = this.safeLoadFromYamlFile(filePath) as V1ClusterRoleBinding
    return this.createClusterRoleBindingFromObj(clusterRoleBinding)
  }

  async createClusterRoleBindingFromObj(yamlClusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    if (!yamlClusterRoleBinding.metadata || !yamlClusterRoleBinding.metadata.name) {
      throw new Error('ClusterRoleBinding object requires name')
    }

    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRoleBinding(yamlClusterRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBinding(name: string, saName: string, saNamespace = '', roleName = '') {
    const clusterRoleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      metadata: {
        name: `${name}`,
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: `${saName}`,
          namespace: `${saNamespace}`,
        },
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: `${roleName}`,
        apiGroup: 'rbac.authorization.k8s.io',
      },
    } as V1ClusterRoleBinding
    return this.createClusterRoleBindingFromObj(clusterRoleBinding)
  }

  async replaceClusterRoleBindingFromObj(clusterRoleBinding: V1ClusterRoleBinding) {
    if (!clusterRoleBinding.metadata || !clusterRoleBinding.metadata.name) {
      throw new Error('Cluster Role Binding must have name specified')
    }

    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.replaceClusterRoleBinding(clusterRoleBinding.metadata.name, clusterRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(name: string, saName: string, saNamespace = '', roleName = '') {
    const clusterRoleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      metadata: {
        name: `${name}`,
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: `${saName}`,
          namespace: `${saNamespace}`,
        },
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: `${roleName}`,
        apiGroup: 'rbac.authorization.k8s.io',
      },
    } as V1ClusterRoleBinding
    return this.replaceClusterRoleBindingFromObj(clusterRoleBinding)
  }

  async deleteRoleBinding(name: string, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteNamespacedRoleBinding(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteClusterRoleBinding(name: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteClusterRoleBinding(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getConfigMap(name = '', namespace = ''): Promise<V1ConfigMap | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      return this.compare(body, name) && body
    } catch {
      return
    }
  }

  async getConfigMapValue(name: string, namespace: string, key: string): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      if (body.data) {
        return body.data[key]
      }
    } catch {
      return
    }
  }

  async createConfigMapFromFile(filePath: string, namespace: string) {
    const yamlConfigMap = this.safeLoadFromYamlFile(filePath) as V1ConfigMap
    return this.createNamespacedConfigMap(namespace, yamlConfigMap)
  }

  public async createNamespacedConfigMap(namespace: string, configMap: V1ConfigMap) {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      const { body } = await k8sCoreApi.createNamespacedConfigMap(namespace, configMap)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchConfigMap(name: string, patch: any, namespace = '') {
    const k8sCoreApi = this.kubeConfig.makeApiClient(PatchedK8sApi)
    try {
      return await k8sCoreApi.patchNamespacedConfigMap(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConfigMap(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedConfigMap(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  public async replaceNamespacedConfigMap(name: string, namespace: string, configMap: V1ConfigMap) {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      const { body } = await k8sCoreApi.replaceNamespacedConfigMap(name, namespace, configMap)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getNamespace(namespace: string): Promise<V1Namespace | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sApi.readNamespace(namespace)
      return body
    } catch {
    }
  }

  async hasReadPermissionsForNamespace(namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(AuthorizationV1Api)
    const accessReview = new V1SelfSubjectAccessReview()
    accessReview.spec = new V1SelfSubjectAccessReviewSpec()
    accessReview.spec.resourceAttributes = {
      group: '',
      name: 'access-to-che-namespace',
      namespace,
      resource: 'namespaces',
      verb: 'get',
    }

    try {
      const { body } = await k8sApi.createSelfSubjectAccessReview(accessReview)
      return body.status!.allowed
    } catch (error) {
      if (error.response && error.response.body) {
        if (error.response.body.code === 403) {
          return false
        }
      }
      throw this.wrapK8sClientError(error)
    }
  }

  async readNamespacedPod(podName: string, namespace: string): Promise<V1Pod | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.readNamespacedPod(podName, namespace)
      if (res && res.body) {
        return res.body
      }
    } catch {
      return
    }
  }

  async patchCustomResource(name: string, namespace: string, patch: any, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    // It is required to patch content-type, otherwise request will be rejected with 415 (Unsupported media type) error.
    const requestOptions = {
      headers: {
        'content-type': 'application/merge-patch+json',
      },
    }

    try {
      const res = await k8sCoreApi.patchNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural, name, patch, undefined, undefined, undefined, requestOptions)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchNamespacedPod(name: string, namespace: string, patch: any): Promise<V1Pod | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    // It is required to patch content-type, otherwise request will be rejected with 415 (Unsupported media type) error.
    const requestOptions = {
      headers: {
        'content-type': 'application/strategic-merge-patch+json',
      },
    }

    try {
      const res = await k8sCoreApi.patchNamespacedPod(name, namespace, patch, undefined, undefined, undefined, undefined, requestOptions)
      if (res && res.body) {
        return res.body
      }
    } catch {
      return
    }
  }

  async podsExistBySelector(selector: string, namespace = ''): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response`)
    }

    return (res.body.items.length > 0)
  }

  /**
   * Returns pod waiting state.
   */
  async getPodWaitingState(namespace: string, selector: string, desiredPhase: string): Promise<V1ContainerStateWaiting | undefined> {
    const pods = await this.getPodListByLabel(namespace, selector)
    if (!pods.length) {
      return
    }

    for (const pod of pods) {
      if (pod.status && pod.status.phase === desiredPhase && pod.status.containerStatuses) {
        for (const status of pod.status.containerStatuses) {
          if (status.state && status.state.waiting && status.state.waiting.message && status.state.waiting.reason) {
            return status.state.waiting
          }
        }
      }
    }
  }

  /**
   * Returns pod last terminated state.
   */
  async getPodLastTerminatedState(namespace: string, selector: string): Promise<V1ContainerStateTerminated | undefined> {
    const pods = await this.getPodListByLabel(namespace, selector)
    if (!pods.length) {
      return
    }

    for (const pod of pods) {
      if (pod.status && pod.status.containerStatuses) {
        for (const status of pod.status.containerStatuses) {
          if (status.lastState) {
            return status.lastState.terminated
          }
        }
      }
    }
  }

  async getPodCondition(namespace: string, selector: string, conditionType: string): Promise<V1PodCondition[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      return []
    }

    const conditions: V1PodCondition[] = []
    for (const pod of res.body.items) {
      if (pod.status && pod.status.conditions) {
        for (const condition of pod.status.conditions) {
          if (condition.type === conditionType) {
            conditions.push(condition)
          }
        }
      }
    }

    return conditions
  }

  async getPodReadyConditionStatus(selector: string, namespace = ''): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response.`)
    }

    if (res.body.items.length < 1) {
      // No pods found by the specified selector. So, it's not ready.
      return 'False'
    }

    if (res.body.items.length > 1) {
      // Several pods found, rolling update?
      return
    }

    if (!res.body.items[0].status || !res.body.items[0].status.conditions || !(res.body.items[0].status.conditions.length > 0)) {
      return
    }

    const conditions = res.body.items[0].status.conditions
    for (const condition of conditions) {
      if (condition.type === 'Ready') {
        return condition.status
      }
    }
  }

  async waitForPodReady(selector: string, namespace: string, intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const readyStatus = await this.getPodReadyConditionStatus(selector, namespace)
      if (readyStatus === 'True') {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to pod ready timeout ${this.podReadyTimeout}`)
  }

  async waitUntilPodIsDeleted(selector: string, namespace = '', intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const pods = await this.listNamespacedPod(namespace, undefined, selector)
      if (!pods.items.length) {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error('ERR_TIMEOUT: Waiting until pod is deleted took too long.')
  }

  async deletePod(name: string, namespace = '') {
    this.kubeConfig.loadFromDefault()
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.deleteNamespacedPod(name, namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  // make sure that flag is specified for command that it's invoked
  async waitLatestReplica(deploymentName: string, namespace = '', intervalMs = 500, timeoutMs = this.podWaitTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const deployment = await this.getDeployment(deploymentName, namespace)
      if (!deployment) {
        throw new Error(`Deployment ${namespace}/${deploymentName} is not found.`)
      }

      const deploymentStatus = deployment.status
      if (!deploymentStatus) {
        throw new Error(`Deployment ${namespace}/${deploymentName} does not have any status`)
      }

      if (deploymentStatus.unavailableReplicas && deploymentStatus.unavailableReplicas > 0) {
        await cli.wait(intervalMs)
      } else {
        return
      }
    }

    throw new Error(`ERR_TIMEOUT: Timeout set to pod wait timeout ${this.podWaitTimeout}`)
  }

  async isDeploymentExist(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sApi.readNamespacedDeployment(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isConfigMapExists(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedConfigMap(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deploymentReady(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      return ((res && res.body &&
        res.body.status && res.body.status.readyReplicas &&
        res.body.status.readyReplicas > 0) as boolean)
    } catch {
      return false
    }
  }

  async deploymentStopped(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      if (res && res.body && res.body.spec && res.body.spec.replicas) {
        throw new Error(`Deployment '${name}' without replicas in spec is fetched`)
      }
      return res.body!.spec!.replicas === 0
    } catch {
      return false
    }
  }

  async isDeploymentPaused(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      if (!res || !res.body || !res.body.spec) {
        throw new Error('E_BAD_DEPLOY_RESPONSE')
      }
      return res.body.spec.paused || false
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async pauseDeployment(name = '', namespace = '') {
    const k8sApi = this.kubeConfig.makeApiClient(PatchedK8sAppsApi)
    try {
      const patch = {
        spec: {
          paused: true,
        },
      }
      await k8sApi.patchNamespacedDeployment(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async resumeDeployment(name = '', namespace = '') {
    const k8sApi = this.kubeConfig.makeApiClient(PatchedK8sAppsApi)
    try {
      const patch = {
        spec: {
          paused: false,
        },
      }
      await k8sApi.patchNamespacedDeployment(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async scaleDeployment(name = '', namespace = '', replicas: number) {
    const k8sAppsApi = this.kubeConfig.makeApiClient(PatchedK8sAppsApi)
    const patch = {
      spec: {
        replicas,
      },
    }
    let res
    try {
      res = await k8sAppsApi.patchNamespacedDeploymentScale(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body) {
      throw new Error('Patch deployment scale returned an invalid response')
    }
  }

  async createDeployment(name: string,
    image: string,
    serviceAccount: string,
    pullPolicy: string,
    configMapEnvSource: string,
    namespace: string) {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    const deployment = new V1Deployment()
    deployment.metadata = new V1ObjectMeta()
    deployment.metadata.name = name
    deployment.metadata.namespace = namespace
    deployment.spec = new V1DeploymentSpec()
    deployment.spec.selector = new V1LabelSelector()
    deployment.spec.selector.matchLabels = { app: name }
    deployment.spec.template = new V1PodTemplateSpec()
    deployment.spec.template.metadata = new V1ObjectMeta()
    deployment.spec.template.metadata.name = name
    deployment.spec.template.metadata.labels = { app: name }
    deployment.spec.template.spec = new V1PodSpec()
    deployment.spec.template.spec.serviceAccountName = serviceAccount
    const opContainer = new V1Container()
    opContainer.name = name
    opContainer.image = image
    opContainer.imagePullPolicy = pullPolicy
    const envFromSource = new V1EnvFromSource()
    envFromSource.configMapRef = new V1ConfigMapEnvSource()
    envFromSource.configMapRef.name = configMapEnvSource
    opContainer.envFrom = [envFromSource]
    deployment.spec.template.spec.containers = [opContainer]

    try {
      return await k8sAppsApi.createNamespacedDeployment(namespace, deployment)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createDeploymentFromFile(filePath: string, namespace: string): Promise<void> {
    const deployment = this.safeLoadFromYamlFile(filePath) as V1Deployment
    return this.createDeploymentFromObj(deployment, namespace)
  }

  async createDeploymentFromObj(yamlDeployment: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.createNamespacedDeployment(namespace, yamlDeployment)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceFromFile(filePath: string, namespace: string): Promise<void> {
    const service = this.safeLoadFromYamlFile(filePath) as V1Service
    return this.createServiceFromObj(service, namespace)
  }

  async isServiceExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedService(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceFromObj(yamlService: V1Service, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.createNamespacedService(namespace, yamlService)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceDeploymentFromObj(yamlDeployment: V1Deployment): Promise<void> {
    // updating restartedAt to make sure that rollout will be restarted
    let annotations = yamlDeployment.spec!.template!.metadata!.annotations
    if (!annotations) {
      annotations = {}
      yamlDeployment.spec!.template!.metadata!.annotations = annotations
    }
    annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString()

    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.replaceNamespacedDeployment(yamlDeployment.metadata!.name!, yamlDeployment.metadata!.namespace!, yamlDeployment)
    } catch (e) {
      if (e.response && e.response.body && e.response.body.message && e.response.body.message.toString().endsWith('field is immutable')) {
        try {
          await k8sAppsApi.deleteNamespacedDeployment(yamlDeployment.metadata!.name!, yamlDeployment.metadata!.namespace!)
          await k8sAppsApi.createNamespacedDeployment(yamlDeployment.metadata!.namespace!, yamlDeployment)
        } catch (e) {
          throw this.wrapK8sClientError(e)
        }
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteDeployment(namespace: string, name: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      k8sAppsApi.deleteNamespacedDeployment(name, namespace)
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(error)
    }
  }

  async deleteAllDeployments(namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteCollectionNamespacedDeployment(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getDeploymentsBySelector(labelSelector = '', namespace = ''): Promise<V1DeploymentList> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sAppsApi.listNamespacedDeployment(namespace, 'true', undefined, undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_NAMESPACES')
  }

  async getDeployment(name: string, namespace: string): Promise<V1Deployment | undefined> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sAppsApi.readNamespacedDeployment(name, namespace)
      if (res && res.body) {
        return res.body!
      }
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(error)
    }
    throw new Error('ERR_GET_DEPLOYMENT')
  }

  async createPod(name: string,
    image: string,
    serviceAccount: string,
    restartPolicy: string,
    pullPolicy: string,
    configMapEnvSource: string,
    namespace: string) {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    const pod = new V1Pod()
    pod.metadata = new V1ObjectMeta()
    pod.metadata.name = name
    pod.metadata.labels = { app: name }
    pod.metadata.namespace = namespace
    pod.spec = new V1PodSpec()
    pod.spec.restartPolicy = restartPolicy
    pod.spec.serviceAccountName = serviceAccount
    const opContainer = new V1Container()
    opContainer.name = name
    opContainer.image = image
    opContainer.imagePullPolicy = pullPolicy
    const envFromSource = new V1EnvFromSource()
    envFromSource.configMapRef = new V1ConfigMapEnvSource()
    envFromSource.configMapRef.name = configMapEnvSource
    opContainer.envFrom = [envFromSource]
    pod.spec.containers = [opContainer]

    try {
      return await k8sCoreApi.createNamespacedPod(namespace, pod)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createJob(name: string,
    image: string,
    serviceAccount: string,
    namespace: string,
    backoffLimit = 0,
    restartPolicy = 'Never') {
    const k8sBatchApi = this.kubeConfig.makeApiClient(BatchV1Api)

    const job = new V1Job()
    job.metadata = new V1ObjectMeta()
    job.metadata.name = name
    job.metadata.labels = { app: name }
    job.metadata.namespace = namespace
    job.spec = new V1JobSpec()
    job.spec.ttlSecondsAfterFinished = 10
    job.spec.backoffLimit = backoffLimit
    job.spec.template = new V1PodTemplateSpec()
    job.spec.template.spec = new V1PodSpec()
    job.spec.template.spec.serviceAccountName = serviceAccount
    const jobContainer = new V1Container()
    jobContainer.name = name
    jobContainer.image = image
    job.spec.template.spec.restartPolicy = restartPolicy
    job.spec.template.spec.containers = [jobContainer]

    try {
      return await k8sBatchApi.createNamespacedJob(namespace, job)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getJob(jobName: string, namespace: string): Promise<V1Job> {
    const k8sBatchApi = this.kubeConfig.makeApiClient(BatchV1Api)

    try {
      const result = await k8sBatchApi.readNamespacedJob(jobName, namespace)
      return result.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitJob(jobName: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/apis/batch/v1/namespaces/${namespace}/jobs/`, {},
        (_phase: string, obj: any) => {
          const job = obj as V1Job

          // Filter other jobs in the given namespace
          if (job && job.metadata && job.metadata.name === jobName) {
            // Check job status
            if (job.status && job.status.succeeded && job.status.succeeded >= 1) {
              // Job is finished, stop watching
              if (request) {
                request.abort()
              }
              // Release awaiter
              resolve()
            }
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      // Automatically stop watching after timeout
      const timeoutHandler = setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${jobName}" job.`)
      }, timeout * 1000)

      // Request job, for case if it is already ready
      const job = await this.getJob(jobName, namespace)
      if (job.status && job.status.succeeded && job.status.succeeded >= 1) {
        // Stop watching
        request.abort()
        clearTimeout(timeoutHandler)

        // Relese awaiter
        resolve()
      }
    })
  }

  async deleteJob(jobName: string, namespace: string): Promise<boolean> {
    const k8sBatchApi = this.kubeConfig.makeApiClient(BatchV1Api)

    try {
      const result = await k8sBatchApi.deleteNamespacedJob(jobName, namespace)
      return result.body.status === 'Success'
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async compare(body: any, name: string): Promise<boolean> {
    if (body && body.metadata && body.metadata.name && body.metadata.name === name) {
      return true
    } else {
      return false
    }
  }

  async createIngressFromFile(filePath: string, namespace: string) {
    const yamlIngress = this.safeLoadFromYamlFile(filePath) as V1Ingress
    return this.createIngressFromObj(yamlIngress, namespace)
  }

  async createIngressFromObj(ingress: V1Ingress, namespace: string) {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      return await networkingV1Api.createNamespacedIngress(namespace, ingress)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIngressExist(name: string, namespace: string): Promise<boolean> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      await networkingV1Api.readNamespacedIngress(name, namespace)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }
      return false
    }
  }

  async deleteAllIngresses(namespace: string): Promise<void> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      await networkingV1Api.deleteCollectionNamespacedIngress(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCrdFromFile(filePath: string): Promise<void> {
    const yaml = this.safeLoadFromYamlFile(filePath)
    if (yaml.apiVersion === this.API_EXTENSIONS_V1BETA1) {
      return this.createCrdV1Beta1(yaml)
    }
    return this.createCrdV1(yaml)
  }

  private async createCrdV1Beta1(yaml: any): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1beta1Api)
    try {
      await k8sApi.createCustomResourceDefinition(yaml)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  private async createCrdV1(yaml: any): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.createCustomResourceDefinition(yaml)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCrdFromFile(filePath: string, resourceVersion: string): Promise<void> {
    const yaml = this.safeLoadFromYamlFile(filePath)
    if (!yaml.metadata || !yaml.metadata.name) {
      throw new Error(`Name is not defined in: ${filePath}`)
    }

    yaml.metadata.resourceVersion = resourceVersion
    if (yaml.apiVersion === this.API_EXTENSIONS_V1BETA1) {
      return this.replaceCrdV1Beta1(yaml)
    }
    return this.replaceCrdV1(yaml)
  }

  private async replaceCrdV1Beta1(yaml: any): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1beta1Api)
    try {
      await k8sApi.replaceCustomResourceDefinition(yaml.metadata.name, yaml)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  private async replaceCrdV1(yaml: any): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.replaceCustomResourceDefinition(yaml.metadata.name, yaml)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getCrd(name: string): Promise<any | undefined> {
    if (await this.IsAPIExtensionSupported('v1')) {
      return this.getCrdV1(name)
    }
    return this.getCrdV1beta1(name)
  }

  private async getCrdV1(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const { body } = await k8sApi.readCustomResourceDefinition(name)
      return body
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  private async getCrdV1beta1(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1beta1Api)
    try {
      const { body } = await k8sApi.readCustomResourceDefinition(name)
      return body
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getCrdStorageVersion(name: string): Promise<string> {
    const crd = await this.getCrd(name)
    if (!crd.spec.versions) {
      // Should never happen
      return 'v1'
    }

    const version = crd.spec.versions.find((v: any) => v.storage)
    return version ? version.name : 'v1'
  }

  async deleteCrd(name: string): Promise<void> {
    if (await this.IsAPIExtensionSupported('v1')) {
      return this.deleteCrdV1(name)
    }
    return this.deleteCrdV1Beta1(name)
  }

  private async deleteCrdV1Beta1(name: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1beta1Api)
    try {
      await k8sApi.deleteCustomResourceDefinition(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  private async deleteCrdV1(name: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.deleteCustomResourceDefinition(name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createCheCluster(cheClusterCR: any, flags: any, ctx: any, useDefaultCR: boolean): Promise<any> {
    const cheNamespace = flags.chenamespace
    if (useDefaultCR) {
      // If CheCluster CR is not explicitly provided, then modify the default example CR
      // with values derived from the other parameters

      if (VersionHelper.isDeployingStableVersion(flags)) {
        // Use images from operator defaults in case of a stable version
        cheClusterCR.spec.server.cheImage = ''
        cheClusterCR.spec.server.cheImageTag = ''
        cheClusterCR.spec.server.pluginRegistryImage = ''
        cheClusterCR.spec.server.devfileRegistryImage = ''
        cheClusterCR.spec.auth.identityProviderImage = ''
      }
      const cheImage = flags.cheimage
      if (cheImage) {
        const [image, tag] = getImageNameAndTag(cheImage)
        cheClusterCR.spec.server.cheImage = image
        cheClusterCR.spec.server.cheImageTag = tag
      }

      if ((flags.installer === 'olm' && !flags[OLM.CATALOG_SOURCE_YAML]) || (flags[OLM.CATALOG_SOURCE_YAML] && flags[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME)) {
        // use default image tag for `olm` to install stable Che, because we don't have next channel for OLM catalog.
        cheClusterCR.spec.server.cheImageTag = ''
      }
      cheClusterCR.spec.server.cheDebug = flags.debug ? flags.debug.toString() : 'false'

      if (isKubernetesPlatformFamily(flags.platform) || !cheClusterCR.spec.auth.openShiftoAuth) {
        cheClusterCR.spec.auth.updateAdminPassword = true
      }

      if (!cheClusterCR.spec.k8s) {
        cheClusterCR.spec.k8s = {}
      }
      if (flags.tls) {
        cheClusterCR.spec.server.tlsSupport = flags.tls
        if (!cheClusterCR.spec.k8s.tlsSecretName) {
          cheClusterCR.spec.k8s.tlsSecretName = DEFAULT_CHE_TLS_SECRET_NAME
        }
      }
      if (flags.domain) {
        cheClusterCR.spec.k8s.ingressDomain = flags.domain
      }
      const pluginRegistryUrl = flags['plugin-registry-url']
      if (pluginRegistryUrl) {
        cheClusterCR.spec.server.pluginRegistryUrl = pluginRegistryUrl
        cheClusterCR.spec.server.externalPluginRegistry = true
      }
      const devfileRegistryUrl = flags['devfile-registry-url']
      if (devfileRegistryUrl) {
        cheClusterCR.spec.server.devfileRegistryUrl = devfileRegistryUrl
        cheClusterCR.spec.server.externalDevfileRegistry = true
      }

      cheClusterCR.spec.storage.postgresPVCStorageClassName = flags['postgres-pvc-storage-class-name']
      cheClusterCR.spec.storage.workspacePVCStorageClassName = flags['workspace-pvc-storage-class-name']

      if (flags['workspace-engine'] === 'dev-workspace') {
        cheClusterCR.spec.devWorkspace.enable = true
      }

      // Use self-signed TLS certificate by default (for versions before 7.14.3).
      // In modern versions of Che this field is ignored.
      cheClusterCR.spec.server.selfSignedCert = true
    }

    cheClusterCR.spec.server.cheClusterRoles = ctx.namespaceEditorClusterRoleName

    // override default values
    if (ctx[ChectlContext.CR_PATCH]) {
      merge(cheClusterCR, ctx[ChectlContext.CR_PATCH])
    }

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.createNamespacedCustomObject('org.eclipse.che', 'v1', cheNamespace, 'checlusters', cheClusterCR)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchCheCluster(name: string, namespace: string, patch: any): Promise<any> {
    try {
      const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

      const { body } = await customObjectsApi.patchNamespacedCustomObject('org.eclipse.che', 'v1', namespace, 'checlusters', name, patch, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } })
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Returns `checlusters.org.eclipse.che' in the given namespace.
   */
  async getCheCluster(cheNamespace: string): Promise<any | undefined> {
    return this.findCustomResource(cheNamespace, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_KIND_PLURAL)
  }

  /**
   * Deletes `checlusters.org.eclipse.che' resources in the given namespace.
   */
  async getAllCheClusters(): Promise<any[]> {
    return this.getAllCustomResources(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_KIND_PLURAL)
  }

  /**
   * Returns custom resource object by its name in the given namespace.
   */
  async getCustomResource(namespace: string, name: string, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const res = await customObjectsApi.getNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural, name)
      return res.body
    } catch (e) {
      if (e.response && e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  /**
   * Returns the only custom resource in the given namespace.
   * Throws error if there is more than one object of given kind.
   */
  async findCustomResource(namespace: string, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural)
      if (!(body as any).items) {
        return
      }

      const crs = (body as any).items as any[]
      if (crs.length === 0) {
        return
      } else if (crs.length !== 1) {
        throw new Error(`Too many resources of type ${resourcePlural}.${resourceAPIGroup} found in the namespace '${namespace}'`)
      }

      return crs[0]
    } catch (e) {
      if (e.response && e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  /**
   * Returns all custom resources
   */
  async getAllCustomResources(resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listClusterCustomObject(resourceAPIGroup, resourceAPIVersion, resourcePlural)
      return (body as any).items ? (body as any).items : []
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        // There is no CRD
        return []
      }
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Deletes `checlusters.org.eclipse.che' resources in the given namespace.
   */
  async deleteCheCluster(namespace: string): Promise<void> {
    return this.deleteCustomResource(namespace, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_KIND_PLURAL)
  }

  /**
   * Deletes custom resources in the given namespace.
   */
  async deleteCustomResource(namespace: string, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural)
      if (!(body as any).items) {
        return
      }

      const crs = (body as any).items as any[]
      for (const cr of crs) {
        await customObjectsApi.deleteNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural, cr.metadata.name)
      }
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        // There is no CRD
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async recreateCheGroupCr(crYaml: any, kindPlural: string): Promise<any> {
    const namespace = crYaml.metadata.namespace
    const name = crYaml.metadata.name

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    // Delete previos CR if any
    try {
      await customObjectsApi.getNamespacedCustomObject(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, namespace, kindPlural, name)
      try {
        await customObjectsApi.deleteNamespacedCustomObject(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, namespace, kindPlural, name)
      } catch (e) {
        // Failed to delete old CR
        throw this.wrapK8sClientError(e)
      }
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
      // Old CR doesn't exists, do nothing
    }

    try {
      const res = await customObjectsApi.createNamespacedCustomObject(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, namespace, kindPlural, crYaml)
      return res.body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async recreateBackupCr(namespace: string, name: string, backupServerConfigName?: string): Promise<V1CheClusterBackup> {
    const backupCr: V1CheClusterBackup = {
      apiVersion: `${CHE_CLUSTER_API_GROUP}/${CHE_CLUSTER_API_VERSION}`,
      kind: 'CheClusterBackup',
      spec: {},
    }
    backupCr.metadata = new V1ObjectMeta()
    backupCr.metadata.name = name
    backupCr.metadata.namespace = namespace
    if (backupServerConfigName) {
      backupCr.spec.backupServerConfigRef = backupServerConfigName
      backupCr.spec.useInternalBackupServer = false
    } else {
      backupCr.spec.useInternalBackupServer = true
    }

    return this.recreateCheGroupCr(backupCr, CHE_CLUSTER_BACKUP_KIND_PLURAL)
  }

  async recreateRestoreCr(namespace: string, name: string, backupServerConfigName?: string, snapshotId?: string): Promise<V1CheClusterBackup> {
    const restoreCr: V1CheClusterRestore = {
      apiVersion: `${CHE_CLUSTER_API_GROUP}/${CHE_CLUSTER_API_VERSION}`,
      kind: 'CheClusterRestore',
      spec: {},
    }
    restoreCr.metadata = new V1ObjectMeta()
    restoreCr.metadata.name = name
    restoreCr.metadata.namespace = namespace
    restoreCr.spec.backupServerConfigRef = backupServerConfigName
    restoreCr.spec.snapshotId = snapshotId

    return this.recreateCheGroupCr(restoreCr, CHE_CLUSTER_RESTORE_KIND_PLURAL)
  }

  async isPreInstalledOLM(): Promise<boolean> {
    const apiApi = this.kubeConfig.makeApiClient(ApisApi)
    try {
      const { body } = await apiApi.getAPIVersions()
      const OLMAPIGroup = body.groups.find(apiGroup => apiGroup.name === 'operators.coreos.com')
      return Boolean(OLMAPIGroup)
    } catch {
      return false
    }
  }

  async getUsersNumber(): Promise<number> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    let amountOfUsers: number
    try {
      const { body } = await customObjectsApi.listClusterCustomObject('user.openshift.io', 'v1', 'users')
      if (!(body as any).items) {
        throw new Error('Unable to get list users.')
      }
      amountOfUsers = (body as any).items.length
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    return amountOfUsers
  }

  async getOpenshiftAuthProviders(): Promise<IdentityProvider[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const oAuthName = 'cluster'
      const { body } = await customObjectsApi.getClusterCustomObject('config.openshift.io', 'v1', 'oauths', oAuthName)
      return (body as OAuth).spec.identityProviders
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async operatorSourceExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1', namespace, 'operatorsources', name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async IsCatalogSourceExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async getOAuthClientAuthorizations(clientName: string): Promise<string[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclientauthorizations')

      if (!(body as any).items) {
        return []
      }
      const oauthClientAuthorizations = (body as any).items as any[]
      return oauthClientAuthorizations.filter(o => o.clientName === clientName)
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        // There is no 'oauthclientauthorizations`
        return []
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteOAuthClientAuthorizations(oAuthClientAuthorizations: any[]): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const filetOauthAuthorizations = oAuthClientAuthorizations.filter((e => e.metadata && e.metadata.name))
      for (const oauthAuthorization of filetOauthAuthorizations) {
        await customObjectsApi.deleteClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclientauthorizations', oauthAuthorization.metadata.name)
      }
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async consoleLinkExists(name: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getClusterCustomObject('console.openshift.io', 'v1', 'consolelinks', name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        // There are no consoleLink
        return false
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConsoleLink(name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteClusterCustomObject('console.openshift.io', 'v1', 'consolelinks', name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getCatalogSource(name: string, namespace: string): Promise<CatalogSource> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
      return body as CatalogSource
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  readCatalogSourceFromFile(filePath: string): CatalogSource {
    const catalogSource = this.safeLoadFromYamlFile(filePath) as CatalogSource
    if (!catalogSource.metadata || !catalogSource.metadata.name) {
      throw new Error(`CatalogSource from ${filePath} must have specified metadata and name`)
    }
    return catalogSource
  }

  async createCatalogSource(catalogSource: CatalogSource) {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const namespace = catalogSource.metadata.namespace!
      const { body } = await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', catalogSource)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitCatalogSource(namespace: string, catalogSourceName: string, timeout = 60): Promise<CatalogSource> {
    return new Promise<CatalogSource>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/catalogsources`,
        { fieldSelector: `metadata.name=${catalogSourceName}` },
        (_phase: string, obj: any) => {
          resolve(obj as CatalogSource)
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${catalogSourceName}" catalog source is created.`)
      }, timeout * 1000)
    })
  }

  async deleteCatalogSource(namespace: string, catalogSourceName: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', catalogSourceName)
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async operatorGroupExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1', namespace, 'operatorgroups', name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async getOperatorGroup(name: string, namespace: string): Promise<OperatorGroup | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1', namespace, 'operatorgroups', name)
      if (response && response.body) {
        return response.body as OperatorGroup
      }
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(error)
    }
  }

  async createOperatorGroup(operatorGroupName: string, namespace: string) {
    const operatorGroup: OperatorGroup = {
      apiVersion: 'operators.coreos.com/v1',
      kind: 'OperatorGroup',
      metadata: {
        name: operatorGroupName,
        namespace,
      },
      spec: {
        targetNamespaces: [namespace],
      },
    }

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1', namespace, 'operatorgroups', operatorGroup)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteOperatorGroup(operatorGroupName: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1', namespace, 'operatorgroups', operatorGroupName)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createOperatorSubscription(subscription: Subscription) {
    const namespace: string = subscription.metadata.namespace!

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', subscription)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getOperatorSubscription(name: string, namespace: string): Promise<Subscription | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
      return body as Subscription
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listOperatorSubscriptions(namespace: string): Promise<Subscription[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await customObjectsApi.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions')
      if (response.body && (response.body as any).items) {
        return (response.body as any).items
      }
      return []
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async operatorSubscriptionExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deleteOperatorSubscription(operatorSubscriptionName: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', operatorSubscriptionName)
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorSubscriptionReadyForApproval(namespace: string, subscriptionName: string, timeout = AWAIT_TIMEOUT_S): Promise<InstallPlan> {
    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
        { fieldSelector: `metadata.name=${subscriptionName}` },
        (_phase: string, obj: any) => {
          const subscription = obj as Subscription
          if (subscription.status && subscription.status.conditions) {
            if (subscription.status.installedCSV) {
              resolve(subscription.status.installplan)
              return
            }
            for (const condition of subscription.status.conditions) {
              if (condition.type === 'InstallPlanPending' && condition.status === 'True') {
                resolve(subscription.status.installplan)
                return
              }
            }
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${subscriptionName}" subscription is ready.`)
      }, timeout * 1000)
    })
  }

  async approveOperatorInstallationPlan(name = '', namespace = '') {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const patch: InstallPlan = {
        spec: {
          approved: true,
        },
      }
      await customObjectsApi.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'installplans', name, patch, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } })
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitUntilOperatorIsInstalled(installPlanName: string, namespace: string, timeout = 240) {
    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/installplans`,
        { fieldSelector: `metadata.name=${installPlanName}` },
        (_phase: string, obj: any) => {
          const installPlan = obj as InstallPlan
          if (installPlan.status && installPlan.status.phase === 'Failed') {
            const errorMessage = []
            for (const condition of installPlan.status.conditions) {
              if (!condition.reason) {
                errorMessage.push(`Reason: ${condition.reason}`)
                errorMessage.push(!condition.message ? `Message: ${condition.message}` : '')
              }
            }
            reject(errorMessage.join(' '))
          }
          if (installPlan.status && installPlan.status.conditions) {
            for (const condition of installPlan.status.conditions) {
              if (condition.type === 'Installed' && condition.status === 'True') {
                resolve(installPlan)
              }
            }
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${installPlanName}" has go status 'Installed'.`)
      }, timeout * 1000)
    })
  }

  async getCSV(csvName: string, namespace: string): Promise<ClusterServiceVersion | undefined> {
    const csvs = await this.getClusterServiceVersions(namespace)
    return csvs.items.find(item => item.metadata.name === csvName)
  }

  async getClusterServiceVersions(namespace: string): Promise<ClusterServiceVersionList> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions')
      return body as ClusterServiceVersionList
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchClusterServiceVersion(namespace: string, name: string, jsonPatch: any[]): Promise<ClusterServiceVersion> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    const requestOptions = {
      headers: {
        'content-type': 'application/json-patch+json',
      },
    }
    try {
      const response = await customObjectsApi.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name, jsonPatch, undefined, undefined, undefined, requestOptions)
      return response.body as ClusterServiceVersion
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterServiceVersion(namespace: string, csvName: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', csvName)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPackageManifect(name: string): Promise<PackageManifest> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('packages.operators.coreos.com', 'v1', 'default', 'packagemanifests', name)
      return body as PackageManifest
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespace(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Returns CRD version of Cert Manager
   */
  async getCertManagerK8sApiVersion(): Promise<string> {
    return this.getCrdStorageVersion('certificates.cert-manager.io')
  }

  async clusterIssuerExists(name: string, version: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If cluster issuers doesn't exist an exception will be thrown
      await customObjectsApi.getClusterCustomObject('cert-manager.io', version, 'clusterissuers', name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isNamespacedCertificateExists(name: string, version: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If cluster issuers doesn't exist an exception will be thrown
      await customObjectsApi.getNamespacedCustomObject('cert-manager.io', version, namespace, 'certificates', name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deleteNamespacedCertificate(name: string, version: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If cluster certificates doesn't exist an exception will be thrown
      await customObjectsApi.deleteNamespacedCustomObject('cert-manager.io', version, namespace, 'certificates', name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteNamespacedIssuer(name: string, version: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject('cert-manager.io', version, namespace, 'issuers', name)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listClusterIssuers(version: string, labelSelector?: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    let res
    try {
      res = await customObjectsApi.listClusterCustomObject('cert-manager.io', version, 'clusterissuers', undefined, undefined, undefined, labelSelector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body) {
      throw new Error('Unable to get cluster issuers list')
    }
    const clusterIssuersList: { items?: any[] } = res.body

    return clusterIssuersList.items || []
  }

  async createCheClusterIssuer(cheClusterIssuerYamlPath: string, version: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    const cheClusterIssuer = this.safeLoadFromYamlFile(cheClusterIssuerYamlPath)
    try {
      await customObjectsApi.createClusterCustomObject('cert-manager.io', version, 'clusterissuers', cheClusterIssuer)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCertificateIssuer(cheClusterIssuerYamlPath: string, version: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    const certificateIssuer = this.safeLoadFromYamlFile(cheClusterIssuerYamlPath)
    try {
      await customObjectsApi.createNamespacedCustomObject('cert-manager.io', version, namespace, 'issuers', certificateIssuer)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isCertificateIssuerExists(name: string, version: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If issuers doesn't exist an exception will be thrown
      await customObjectsApi.getNamespacedCustomObject('cert-manager.io', version, namespace, 'issuers', name)
      return true
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createCheClusterCertificate(certificate: V1Certificate, version: string): Promise<void> {
    if (!certificate.metadata?.namespace) {
      throw new Error('Expected namespace in metadata')
    }

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.createNamespacedCustomObject('cert-manager.io', version, certificate.metadata.namespace, 'certificates', certificate)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async currentContext(): Promise<string> {
    return this.kubeConfig.getCurrentContext()
  }

  getContext(name: string): Context | null {
    return this.kubeConfig.getContextObject(name)
  }

  /**
   * Retrieve the default token from the default serviceAccount.
   */
  async getDefaultServiceAccountToken(): Promise<string> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    const namespaceName = 'default'
    const saName = 'default'
    let res
    // now get the matching secrets
    try {
      res = await k8sCoreApi.listNamespacedSecret(namespaceName)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    if (!res || !res.body) {
      throw new Error('Unable to get default service account')
    }
    const v1SecretList = res.body

    if (!v1SecretList.items || v1SecretList.items.length === 0) {
      throw new Error(`Unable to get default service account token since there is no secret in '${namespaceName}' namespace`)
    }

    const v1DefaultSATokenSecret = v1SecretList.items.find(secret => secret.metadata!.annotations &&
      secret.metadata!.annotations['kubernetes.io/service-account.name'] === saName &&
      secret.type === 'kubernetes.io/service-account-token')

    if (!v1DefaultSATokenSecret) {
      throw new Error(`Secret for '${saName}' service account is not found in namespace '${namespaceName}'`)
    }

    return Buffer.from(v1DefaultSATokenSecret.data!.token, 'base64').toString()
  }

  async checkKubeApi() {
    const currentCluster = this.kubeConfig.getCurrentCluster()
    if (!currentCluster) {
      throw new Error(`The current context is unknown. It should be set using '${getClusterClientCommand()} config use-context <CONTEXT_NAME>' or in another way.`)
    }

    try {
      await this.requestKubeHealthz(currentCluster)
    } catch (error) {
      if (error.message && (error.message as string).includes('E_K8S_API_UNAUTHORIZED')) {
        const token = await this.getDefaultServiceAccountToken()
        await this.requestKubeHealthz(currentCluster, token)
      } else {
        throw error
      }
    }
  }

  async requestKubeHealthz(currentCluster: Cluster, token?: string) {
    const endpoint = `${currentCluster.server}/healthz`

    try {
      const config: AxiosRequestConfig = {
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
          requestCert: true,
        }),
        headers: token && { Authorization: 'bearer ' + token },
      }

      const response = await axios.get(`${endpoint}`, config)
      if (!response || response.status !== 200 || response.data !== 'ok') {
        throw new Error('E_BAD_RESP_K8S_API')
      }
    } catch (error) {
      if (error.response && error.response.status === 403) {
        throw new Error(`E_K8S_API_FORBIDDEN - Message: ${error.response.data.message}`)
      }
      if (error.response && error.response.status === 401) {
        throw new Error(`E_K8S_API_UNAUTHORIZED - Message: ${error.response.data.message}`)
      }
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`E_K8S_API_UNKNOWN_ERROR - Status: ${error.response.status}`)
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        throw new Error(`E_K8S_API_NO_RESPONSE - Endpoint: ${endpoint} - Error message: ${error.message}`)
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`E_CHECTL_UNKNOWN_ERROR - Message: ${error.message}`)
      }
    }
  }

  async isOpenShift(): Promise<boolean> {
    return this.IsAPIGroupSupported('apps.openshift.io')
  }

  async isOpenShift3(): Promise<boolean> {
    const isAppsAPISupported = await this.IsAPIGroupSupported('apps.openshift.io')
    const isConfigAPISupported = await this.IsAPIGroupSupported('config.openshift.io')
    return isAppsAPISupported && !isConfigAPISupported
  }

  async isOpenShift4(): Promise<boolean> {
    const isRouteAPISupported = await this.IsAPIGroupSupported('route.openshift.io')
    const isConfigAPISupported = await this.IsAPIGroupSupported('config.openshift.io')
    return isRouteAPISupported && isConfigAPISupported
  }

  async IsAPIExtensionSupported(version: string): Promise<boolean> {
    return this.IsAPIGroupSupported('apiextensions.k8s.io', version)
  }

  async IsAPIGroupSupported(name: string, version?: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(ApisApi)
    try {
      const res = await k8sCoreApi.getAPIVersions()
      if (!res || !res.body || !res.body.groups) {
        return false
      }

      const group = res.body.groups.find(g => g.name === name)
      if (!group) {
        return false
      }

      if (version) {
        return Boolean(group.versions.find(v => v.version === version))
      } else {
        return Boolean(group)
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getIngressHost(name: string, namespace: string): Promise<string> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      const res = await networkingV1Api.readNamespacedIngress(name, namespace)
      if (res && res.body &&
        res.body.spec &&
        res.body.spec.rules &&
        res.body.spec.rules.length > 0) {
        return res.body.spec.rules[0].host || ''
      }
      throw new Error('ERR_INGRESS_NO_HOST')
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getIngressProtocol(name: string, namespace: string): Promise<string> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      const res = await networkingV1Api.readNamespacedIngress(name, namespace)
      if (!res || !res.body || !res.body.spec) {
        throw new Error('ERR_INGRESS_NO_HOST')
      }
      if (res.body.spec.tls && res.body.spec.tls.length > 0) {
        return 'https'
      } else {
        return 'http'
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getIngressesBySelector(labelSelector: string, namespace: string): Promise<V1IngressList> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      const res = await networkingV1Api.listNamespacedIngress(namespace, 'true', undefined, undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_INGRESSES')
  }

  async getSecret(name: string, namespace: string): Promise<V1Secret | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    // now get the matching secrets
    try {
      const res = await k8sCoreApi.readNamespacedSecret(name, namespace)
      if (res && res.body && res.body) {
        return res.body
      } else {
        return
      }
    } catch {
      return
    }
  }

  /**
   * Creates a secret with given name and data.
   * Data should not be base64 encoded.
   */
  async createSecret(namespace: string, name: string, data: { [key: string]: string }): Promise<V1Secret | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    const secret = new V1Secret()
    secret.metadata = new V1ObjectMeta()
    secret.metadata.name = name
    secret.metadata.namespace = namespace
    secret.stringData = data

    try {
      return (await k8sCoreApi.createNamespacedSecret(namespace, secret)).body
    } catch {
      return
    }
  }

  /**
   * Deletes specified secret if any.
   */
  async deleteSecret(namespace: string, name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedSecret(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  /**
   * Replaces given secret or creates a new one.
   * Data should not be base64 encoded.
   */
  async createOrReplaceSecret(namespace: string, name: string, data: { [key: string]: string }): Promise<V1Secret | undefined> {
    const existingSecret = await this.getSecret(name, namespace)
    if (existingSecret) {
      const base64encodedData: { [key: string]: string } = {}
      for (const key of Object.keys(data)) {
        base64encodedData[key] = base64Encode(data[key])
      }

      if (this.isSecretsDataEqual(existingSecret.data || {}, base64encodedData)) {
        return existingSecret
      }

      // The secrets are different, replace existing secret
      existingSecret.stringData = data
      delete existingSecret.data
      if (existingSecret.metadata) {
        delete existingSecret.metadata.resourceVersion
      }

      const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
      try {
        const res = await k8sCoreApi.replaceNamespacedSecret(name, namespace, existingSecret)
        return res.body
      } catch (e) {
        throw this.wrapK8sClientError(e)
      }
    }
    return this.createSecret(namespace, name, data)
  }

  isSecretsDataEqual(data1: { [key: string]: string }, data2: { [key: string]: string }): boolean {
    if (Object.keys(data1).length !== Object.keys(data2).length) {
      return false
    }
    for (const key in data1) {
      if (data1[key] !== data2[key]) {
        return false
      }
    }
    return true
  }

  /**
   * Awaits secret to be present and contain non-empty data fields specified in dataKeys parameter.
   */
  async waitSecret(secretName: string, namespace: string, dataKeys: string[] = [], timeout = AWAIT_TIMEOUT_S): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/api/v1/namespaces/${namespace}/secrets/`, { fieldSelector: `metadata.name=${secretName}` },
        (_phase: string, obj: any) => {
          const secret = obj as V1Secret

          // Check all required data fields to be present
          if (dataKeys.length > 0 && secret.data) {
            for (const key of dataKeys) {
              if (!secret.data[key]) {
                // Key is missing or empty
                return
              }
            }
          }

          // The secret with all specified fields is present, stop watching
          if (request) {
            request.abort()
          }
          // Release awaiter
          resolve()
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      // Automatically stop watching after timeout
      const timeoutHandler = setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${secretName}" secret.`)
      }, timeout * 1000)

      // Request secret, for case if it is already exist
      const secret = await this.getSecret(secretName, namespace)
      if (secret) {
        // Stop watching
        request.abort()
        clearTimeout(timeoutHandler)

        // Relese awaiter
        resolve()
      }
    })
  }

  async persistentVolumeClaimExist(name = '', namespace = ''): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedPersistentVolumeClaim(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deletePersistentVolumeClaim(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedPersistentVolumeClaim(name, namespace)
    } catch (e) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPersistentVolumeClaimsBySelector(labelSelector = '', namespace = ''): Promise<V1PersistentVolumeClaimList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedPersistentVolumeClaim(namespace, 'true', undefined, undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_PVCS')
  }

  async listNamespace(): Promise<V1NamespaceList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespace()
      if (res && res.body) {
        return res.body
      } else {
        return {
          items: [],
        }
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, fieldSelector, labelSelector)
      if (res && res.body) {
        return res.body
      } else {
        return {
          items: [],
        }
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Reads log by chunk and writes into a file.
   */
  async readNamespacedPodLog(pod: string, namespace: string, container: string, filename: string, follow: boolean): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const logHelper = new Log(this.kubeConfig)
      const stream = new Writable()
      stream._write = function (chunk, encoding, done) {
        fs.appendFileSync(filename, chunk, { encoding })
        done()
      }

      await logHelper.log(namespace, pod, container, stream, error => {
        stream.end()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }, { follow })
    })
  }

  /**
   * Forwards port, based on the example
   * https://github.com/kubernetes-client/javascript/blob/master/examples/typescript/port-forward/port-forward.ts
   */
  async portForward(podName: string, namespace: string, port: number): Promise<void> {
    const portForwardHelper = new PortForward(this.kubeConfig, true)
    try {
      const server = net.createServer(async socket => {
        await portForwardHelper.portForward(namespace, podName, [port], socket, null, socket)
      })
      server.listen(port, 'localhost')
      return
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Checks if message is present and returns error with it
   * or returns error with the specified error if message is not found.
   *
   * @param e k8s error to wrap
   */
  private wrapK8sClientError(e: any): Error {
    if (e.response && e.response.body) {
      if (e.response.body.message) {
        return newError(e.response.body.message, e)
      }
      return newError(e.response.body, e)
    }
    return e
  }

  public safeLoadFromYamlFile(filePath: string): any {
    return safeLoadFromYamlFile(filePath)
  }
}

class PatchedK8sApi extends CoreV1Api {
  patchNamespacedConfigMap(...args: any) {
    const oldDefaultHeaders = this.defaultHeaders
    this.defaultHeaders = {
      'Content-Type': 'application/strategic-merge-patch+json',
      ...this.defaultHeaders,
    }
    const returnValue = super.patchNamespacedConfigMap.apply(this, args)
    this.defaultHeaders = oldDefaultHeaders
    return returnValue
  }
}

class PatchedK8sAppsApi extends AppsV1Api {
  patchNamespacedDeployment(...args: any) {
    const oldDefaultHeaders = this.defaultHeaders
    this.defaultHeaders = {
      'Content-Type': 'application/strategic-merge-patch+json',
      ...this.defaultHeaders,
    }
    const returnValue = super.patchNamespacedDeployment.apply(this, args)
    this.defaultHeaders = oldDefaultHeaders
    return returnValue
  }

  patchNamespacedDeploymentScale(...args: any) {
    const oldDefaultHeaders = this.defaultHeaders
    this.defaultHeaders = {
      'Content-Type': 'application/strategic-merge-patch+json',
      ...this.defaultHeaders,
    }
    const returnValue = super.patchNamespacedDeploymentScale.apply(this, args)
    this.defaultHeaders = oldDefaultHeaders
    return returnValue
  }
}
