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
  AdmissionregistrationV1Api,
  ApiextensionsV1Api,
  ApisApi,
  AppsV1Api,
  AuthorizationV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  Log,
  NetworkingV1Api,
  PortForward,
  RbacAuthorizationV1Api,
  V1ClusterRole,
  V1ClusterRoleBinding,
  V1ClusterRoleBindingList,
  V1ConfigMap,
  V1ContainerStateTerminated,
  V1ContainerStateWaiting,
  V1Deployment,
  V1Ingress,
  V1Namespace,
  V1ObjectMeta,
  V1Pod,
  V1PodCondition,
  V1PodList,
  V1Role,
  V1RoleBinding,
  V1RoleBindingList,
  V1RoleList,
  V1Secret,
  V1SelfSubjectAccessReview,
  V1SelfSubjectAccessReviewSpec,
  V1Service,
  V1ServiceAccount,
  V1ServiceList,
  Watch,
  V1CustomResourceDefinition, V1ValidatingWebhookConfiguration,
} from '@kubernetes/client-node'
import { Cluster } from '@kubernetes/client-node/dist/config_types'
import axios, { AxiosRequestConfig } from 'axios'
import { cli } from 'cli-ux'
import * as execa from 'execa'
import * as fs from 'fs'
import * as https from 'https'
import { merge } from 'lodash'
import * as net from 'net'
import { Writable } from 'stream'
import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION_V1, CHE_CLUSTER_API_VERSION_V2, CHE_CLUSTER_KIND_PLURAL, CHE_TLS_SECRET_NAME, DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT, DEFAULT_K8S_POD_WAIT_TIMEOUT } from '../constants'
import { getClusterClientCommand, getImageNameAndTag, isCheClusterAPIV1, isWebhookAvailabilityError, newError, safeLoadFromYamlFile, sleep } from '../util'
import { ChectlContext } from './context'
import { V1Certificate } from './types/cert-manager'
import { CatalogSource, ClusterServiceVersion, ClusterServiceVersionList, InstallPlan, Subscription } from './types/olm'

const AWAIT_TIMEOUT_S = 30

export class KubeHelper {
  public readonly kubeConfig

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

  async createNamespaceFromFile(filePath: string): Promise<void> {
    const namespace = this.safeLoadFromYamlFile(filePath) as V1Namespace
    return this.createNamespace(namespace)
  }

  async createNamespace(namespace: V1Namespace): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.createNamespace(namespace)
    } catch (e: any) {
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

  async deleteService(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      await k8sApi.deleteNamespacedService(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
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
          } catch (error: any) {
            if (error.response.statusCode !== 404) {
              throw error
            }
          }
        })
      }
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async applyResource(yamlPath: string, opts = ''): Promise<void> {
    const command = `kubectl apply -f ${yamlPath} ${opts}`
    await execa(command, { timeout: 60000, shell: true })
  }

  async getServicesBySelector(labelSelector: string, namespace: string): Promise<V1ServiceList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService(namespace, 'true', undefined, undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_SERVICES')
  }

  async isServiceAccountExist(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedServiceAccount(name, namespace)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deleteServiceAccount(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedServiceAccount(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createServiceAccountFromFile(filePath: string, namespace: string): Promise<void> {
    const yamlServiceAccount = this.safeLoadFromYamlFile(filePath) as V1ServiceAccount

    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete yamlServiceAccount.metadata?.namespace
      await k8sCoreApi.createNamespacedServiceAccount(namespace, yamlServiceAccount)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceServiceAccountFromFile(filePath: string, namespace: string): Promise<void> {
    const yamlServiceAccount = this.safeLoadFromYamlFile(filePath) as V1ServiceAccount

    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete yamlServiceAccount.metadata?.namespace
      await k8sCoreApi.replaceNamespacedServiceAccount(yamlServiceAccount.metadata!.name!, namespace, yamlServiceAccount)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRole(name, namespace)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async isClusterRoleExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRole(name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async listRoles(namespace: string): Promise<V1RoleList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listNamespacedRole(namespace)
      return res.body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createRole(yamlRole: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete yamlRole.metadata?.namespace
      await k8sRbacAuthApi.createNamespacedRole(namespace, yamlRole)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRole(yamlRole: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete yamlRole.metadata?.namespace
      await k8sRbacAuthApi.replaceNamespacedRole(yamlRole.metadata!.name!, namespace, yamlRole)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listClusterRoles(): Promise<V1RoleList> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.listClusterRole()
      return res.body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRole(yamlClusterRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRole(yamlClusterRole)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleFromFile(filePath: string): Promise<void> {
    const yamlClusterRole = this.safeLoadFromYamlFile(filePath) as V1ClusterRole
    return this.createClusterRole(yamlClusterRole)
  }

  async replaceClusterRoleFromObj(yamlClusterRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRole(yamlClusterRole.metadata!.name!, yamlClusterRole)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRole(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteNamespacedRole(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPodListByLabel(namespace: string, labelSelector: string): Promise<V1Pod[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const {body: podList} = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector)

      return podList.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteClusterRole(name)
    } catch (e: any) {
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
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleBindingExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRoleBinding(name, namespace)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isValidatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readValidatingWebhookConfiguration(name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceValidatingWebhookConfiguration(name: string, webhook: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.replaceValidatingWebhookConfiguration(name, webhook)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createValidatingWebhookConfiguration(webhook: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createValidatingWebhookConfiguration(webhook)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteValidatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteValidatingWebhookConfiguration(name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteMutatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteMutatingWebhookConfiguration(name)
    } catch (e: any) {
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
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isClusterRoleBindingExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRoleBinding(name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createRoleBinding(yamlRoleBinding: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete yamlRoleBinding.metadata?.namespace
      await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, yamlRoleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBinding(yamlRoleBinding: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete yamlRoleBinding.metadata?.namespace
      await k8sRbacAuthApi.replaceNamespacedRoleBinding(yamlRoleBinding.metadata!.name!, namespace, yamlRoleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBindingRoleFromFile(filePath: string): Promise<void> {
    const clusterRoleBinding = this.safeLoadFromYamlFile(filePath) as V1ClusterRoleBinding
    return this.createClusterRoleBinding(clusterRoleBinding)
  }

  async createClusterRoleBinding(yamlClusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRoleBinding(yamlClusterRoleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(clusterRoleBinding: V1ClusterRoleBinding) {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.replaceClusterRoleBinding(clusterRoleBinding.metadata!.name!, clusterRoleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRoleBinding(name: string, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteNamespacedRoleBinding(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteClusterRoleBinding(name: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteClusterRoleBinding(name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getConfigMap(name: string, namespace: string): Promise<V1ConfigMap | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      return body
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listConfigMaps(namespace: string): Promise<V1ConfigMap[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.listNamespacedConfigMap(namespace)
      return body.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    return []
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

  public async createConfigMap(configMap: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      delete configMap.metadata?.namespace
      await k8sCoreApi.createNamespacedConfigMap(namespace, configMap)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConfigMap(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedConfigMap(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteSecret(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedSecret(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
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
    } catch (error: any) {
      if (error.response && error.response.body) {
        if (error.response.body.code === 403) {
          return false
        }
      }
      throw this.wrapK8sClientError(error)
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
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
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
    } catch (e: any) {
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

  async getPodReadyConditionStatus(selector: string, namespace: string): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)
    } catch (e: any) {
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

  async waitUntilPodIsDeleted(selector: string, namespace: string, intervalMs = 500, timeoutMs = this.podReadyTimeout) {
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

  // make sure that flag is specified for command that it's invoked
  async waitLatestReplica(name: string, namespace: string, intervalMs = 500, timeoutMs = this.podWaitTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const deployment = await this.getDeployment(name, namespace)
      if (!deployment) {
        throw new Error(`Deployment ${namespace}/${name} is not found.`)
      }

      const deploymentStatus = deployment.status
      if (!deploymentStatus) {
        throw new Error(`Deployment ${namespace}/${name} does not have any status`)
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
    } catch (e: any) {
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
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isDeploymentReady(name: string, namespace: string): Promise<boolean> {
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

  async isDeploymentStopped(name: string, namespace: string): Promise<boolean> {
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

  async scaleDeployment(name: string, namespace: string, replicas: number) {
    const k8sAppsApi = this.kubeConfig.makeApiClient(PatchedK8sAppsApi)
    const patch = {
      spec: {
        replicas,
      },
    }
    let res
    try {
      res = await k8sAppsApi.patchNamespacedDeploymentScale(name, namespace, patch)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body) {
      throw new Error('Patch deployment scale returned an invalid response')
    }
  }

  async createDeploymentFromFile(filePath: string, namespace: string): Promise<void> {
    const deployment = this.safeLoadFromYamlFile(filePath) as V1Deployment
    return this.createDeployment(deployment, namespace)
  }

  async createDeployment(yamlDeployment: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      delete yamlDeployment.metadata?.namespace
      await k8sAppsApi.createNamespacedDeployment(namespace, yamlDeployment)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceFromFile(filePath: string, namespace: string): Promise<void> {
    const service = this.safeLoadFromYamlFile(filePath) as V1Service
    return this.createService(service, namespace)
  }

  async replaceService(name: string, service: V1Service, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedService(name, namespace)
      service.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion

      delete service.metadata?.namespace
      await k8sCoreApi.replaceNamespacedService(name, namespace, service)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isServiceExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedService(name, namespace)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createService(yamlService: V1Service, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete yamlService.metadata?.namespace
      await k8sApi.createNamespacedService(namespace, yamlService)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceDeployment(yamlDeployment: V1Deployment): Promise<void> {
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
    } catch (e: any) {
      if (e.response && e.response.body && e.response.body.message && e.response.body.message.toString().endsWith('field is immutable')) {
        try {
          await k8sAppsApi.deleteNamespacedDeployment(yamlDeployment.metadata!.name!, yamlDeployment.metadata!.namespace!)
          await k8sAppsApi.createNamespacedDeployment(yamlDeployment.metadata!.namespace!, yamlDeployment)
        } catch (e: any) {
          throw this.wrapK8sClientError(e)
        }
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteDeployment(name: string, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteNamespacedDeployment(name, namespace)
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteAllDeployments(namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteCollectionNamespacedDeployment(namespace)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getDeployment(name: string, namespace: string): Promise<V1Deployment | undefined> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sAppsApi.readNamespacedDeployment(name, namespace)
      if (res && res.body) {
        return res.body!
      }
    } catch (error: any) {
      if (error.response && error.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(error)
    }
    throw new Error('ERR_GET_DEPLOYMENT')
  }

  async createIngress(ingress: V1Ingress, namespace: string) {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      delete ingress.metadata?.namespace
      return await networkingV1Api.createNamespacedIngress(namespace, ingress)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIngressExist(name: string, namespace: string): Promise<boolean> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      await networkingV1Api.readNamespacedIngress(name, namespace)
      return true
    } catch (e: any) {
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
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCrdFromFile(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.createCustomResourceDefinition(crd)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCrdFromFile(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const response = await k8sApi.readCustomResourceDefinition(crd.metadata!.name!)
      crd.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion

      await k8sApi.replaceCustomResourceDefinition(crd.metadata!.name!, crd)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getCrd(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const { body } = await k8sApi.readCustomResourceDefinition(name)
      return body
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createCheCluster(cheClusterCR: any, flags: any, ctx: any, useDefaultCR: boolean): Promise<any> {
    const isCheClusterApiV1 = isCheClusterAPIV1(cheClusterCR)
    const cheClusterApiVersion = isCheClusterApiV1 ? CHE_CLUSTER_API_VERSION_V1 : CHE_CLUSTER_API_VERSION_V2

    const cheNamespace = flags.chenamespace
    if (useDefaultCR) {
      if (isCheClusterApiV1) {
        if (flags.cheimage) {
          const [image, tag] = getImageNameAndTag(flags.cheimage)
          cheClusterCR.spec.server.cheImage = image
          cheClusterCR.spec.server.cheImageTag = tag
        }

        cheClusterCR.spec.server.cheDebug = flags.debug ? flags.debug.toString() : 'false'

        if (!cheClusterCR.spec.k8s?.tlsSecretName) {
          merge(cheClusterCR, { spec: { k8s: { tlsSecretName: CHE_TLS_SECRET_NAME } } })
        }

        if (flags.domain) {
          merge(cheClusterCR, { spec: { k8s: { ingressDomain: flags.domain } } })
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

        if (flags['postgres-pvc-storage-class-name']) {
          cheClusterCR.spec.storage.postgresPVCStorageClassName = flags['postgres-pvc-storage-class-name']
        }

        if (flags['workspace-pvc-storage-class-name']) {
          cheClusterCR.spec.storage.workspacePVCStorageClassName = flags['workspace-pvc-storage-class-name']
        }
      } else {
        if (flags.cheimage) {
          merge(cheClusterCR, { spec: { components: { cheServer: { deployment: { containers: [{ image: flags.cheimage }] } } } } })
        }

        merge(cheClusterCR, { spec: { components: { cheServer: { debug: flags.debug } } } })

        if (!ctx[ChectlContext.IS_OPENSHIFT]) {
          if (!cheClusterCR.spec.networking?.tlsSecretName) {
            merge(cheClusterCR, { spec: { networking: { tlsSecretName: CHE_TLS_SECRET_NAME } }  })
          }

          if (flags.domain) {
            merge(cheClusterCR, { spec: { networking: { domain: flags.domain } }  })
          }
        }

        const pluginRegistryUrl = flags['plugin-registry-url']
        if (pluginRegistryUrl) {
          merge(cheClusterCR, { spec: { components: { pluginRegistry: { disableInternalRegistry: true, externalPluginRegistries: [{ url: pluginRegistryUrl }]} } } })
        }

        const devfileRegistryUrl = flags['devfile-registry-url']
        if (devfileRegistryUrl) {
          merge(cheClusterCR, { spec: { components: { devfileRegistry: { disableInternalRegistry: true, externalDevfileRegistries: [{ url: devfileRegistryUrl }]} } } })
        }

        if (flags['postgres-pvc-storage-class-name']) {
          merge(cheClusterCR, { spec: { components: { database: { pvc: { storageClass: flags['postgres-pvc-storage-class-name'] } } } } })
        }

        if (flags['workspace-pvc-storage-class-name']) {
          merge(cheClusterCR, { spec: {workspaces: { storage: { pvc: { storageClass: flags['workspace-pvc-storage-class-name'] } } } } })
        }
      }
    }

    if (ctx.namespaceEditorClusterRoleName) {
      if (isCheClusterApiV1) {
        cheClusterCR.spec.server.cheClusterRoles = ctx.namespaceEditorClusterRoleName
      } else {
        merge(cheClusterCR, { spec: {components: { cheServer: { clusterRoles: (ctx.namespaceEditorClusterRoleName as string).split(',')} } } })
      }
    }

    // override default values with patch
    if (ctx[ChectlContext.CR_PATCH]) {
      merge(cheClusterCR, ctx[ChectlContext.CR_PATCH])
    }

    // TODO remove in the future version
    for (let i = 0; i < 30; i++) {
      const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
      try {
        delete cheClusterCR.metadata?.namespace
        const {body} = await customObjectsApi.createNamespacedCustomObject(CHE_CLUSTER_API_GROUP, cheClusterApiVersion, cheNamespace, CHE_CLUSTER_KIND_PLURAL, cheClusterCR)
        return body
      } catch (e: any) {
        const wrappedError = this.wrapK8sClientError(e)
        if (isWebhookAvailabilityError(wrappedError)) {
          await sleep(5 * 1000)
        } else {
          throw wrappedError
        }
      }
    }
  }

  async patchCheCluster(name: string, namespace: string, patch: any): Promise<any> {
    if (!patch.apiVersion) {
      throw new Error('Patch must contain CheCluster api version.')
    }

    const isCheClusterApiV1 = isCheClusterAPIV1(patch)
    const cheClusterApiVersion = isCheClusterApiV1 ? CHE_CLUSTER_API_VERSION_V1 : CHE_CLUSTER_API_VERSION_V2

    try {
      const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
      const { body } = await customObjectsApi.patchNamespacedCustomObject(CHE_CLUSTER_API_GROUP, cheClusterApiVersion, namespace, CHE_CLUSTER_KIND_PLURAL, name, patch, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } })
      return body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Returns `checlusters.org.eclipse.che' in the given namespace.
   */
  async getCheClusterV1(cheNamespace: string): Promise<any | undefined> {
    // TODO remove in the future version
    for (let i = 0; i < 30; i++) {
      try {
        return await this.findCustomResource(cheNamespace, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION_V1, CHE_CLUSTER_KIND_PLURAL)
      } catch (e: any) {
        if (isWebhookAvailabilityError(e)) {
          await sleep(5 * 1000)
        } else {
          throw e
        }
      }
    }
  }

  async getAllCheClusters(): Promise<any[]> {
    // TODO remove in the future version
    for (let i = 0; i < 30; i++) {
      try {
        return await this.listCustomResources(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION_V1, CHE_CLUSTER_KIND_PLURAL)
      } catch (e: any) {
        if (isWebhookAvailabilityError(e)) {
          await sleep(5 * 1000)
        } else {
          throw e
        }
      }
    }

    return []
  }

  async deleteAllCustomResources(apiGroup: string, version: string, plural: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    let resources = await this.listCustomResources(apiGroup, version, plural)
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await customObjectsApi.deleteNamespacedCustomObject(apiGroup, version, namespace, plural, name, 60)
      } catch (e: any) {
        // ignore, check existence later
      }
    }

    for (let i = 0; i < 12; i++) {
      await cli.wait(5 * 1000)
      const resources = await this.listCustomResources(apiGroup, version, plural)
      if (resources.length === 0) {
        return
      }
    }

    // remove finalizers
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await this.patchCustomResource(name, namespace, { metadata: { finalizers: null } }, apiGroup, version, plural)
      } catch (error) {
        if (!await this.getCustomResource(name, namespace, apiGroup, version, plural)) {
          continue // successfully removed
        }
        throw error
      }
    }

    // wait for some time and check again
    await cli.wait(5000)

    resources = await this.listCustomResources(apiGroup, version, plural)
    if (resources.length !== 0) {
      throw new Error(`Failed to remove Custom Resource ${apiGroup}/${version}, ${resources.length} left.`)
    }
  }

  /**
   * Returns custom resource object by its name in the given namespace.
   */
  async getCustomResource(name: string, namespace: string, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const res = await customObjectsApi.getNamespacedCustomObject(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural, name)
      return res.body
    } catch (e: any) {
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
    } catch (e: any) {
      if (e.response && e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  /**
   * Returns all custom resources
   */
  async listCustomResources(resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listClusterCustomObject(resourceAPIGroup, resourceAPIVersion, resourcePlural)
      return (body as any).items ? (body as any).items : []
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        // There is no CRD
        return []
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteAllCheClusters(namespace: string): Promise<void> {
    return this.deleteCustomResource(namespace, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION_V1, CHE_CLUSTER_KIND_PLURAL)
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
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        // There is no CRD
        return
      }
      throw this.wrapK8sClientError(e)
    }
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

  async isCatalogSourceExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async listCatalogSources(namespace: string, labelSelector: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await customObjectsApi.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', undefined, undefined, undefined, labelSelector)
      return (body as any).items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listOAuthClientBySelector(selector: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await customObjectsApi.listClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclients', undefined, undefined, undefined, selector)
      return (body as any).items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteOAuthClient(name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclients', name)
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConsoleLink(name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteClusterCustomObject('console.openshift.io', 'v1', 'consolelinks', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  readCatalogSourceFromFile(filePath: string): CatalogSource {
    const catalogSource = this.safeLoadFromYamlFile(filePath) as CatalogSource
    if (!catalogSource.metadata || !catalogSource.metadata.name) {
      throw new Error(`CatalogSource from ${filePath} must have specified metadata and name`)
    }
    return catalogSource
  }

  async createCatalogSource(catalogSource: CatalogSource, namespace: string) {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      delete catalogSource.metadata?.namespace
      const { body } = await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', catalogSource)
      return body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitCatalogSource(name: string, namespace: string, timeout = 60): Promise<CatalogSource> {
    return new Promise<CatalogSource>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/catalogsources`,
        { fieldSelector: `metadata.name=${name}` },
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
        reject(`Timeout reached while waiting for "${name}" catalog source is created.`)
      }, timeout * 1000)
    })
  }

  async deleteCatalogSource(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async createOperatorSubscription(subscription: Subscription) {
    const namespace: string = subscription.metadata.namespace!

    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', subscription)
      return body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getOperatorSubscription(name: string, namespace: string): Promise<Subscription | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
      return body as Subscription
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async waitInstalledCSVInSubscription(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: any) => {
          const subscription = obj as Subscription
          if (subscription.status && subscription.status.installedCSV) {
            resolve(subscription.status.installedCSV)
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for installed CSV of '${name}' subscription.`)
      }, timeout * 1000)
    })
  }

  async waitCSVStatusPhase(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/clusterserviceversions`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: any) => {
          const csv = obj as ClusterServiceVersion
          if (csv.status && csv.status.phase) {
            resolve(csv.status.phase)
          }
        },
        error => {
          if (error) {
            reject(error)
          }
        })

      setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting CSV '${name}' status.`)
      }, timeout * 1000)
    })
  }

  async listOperatorSubscriptions(namespace: string): Promise<Subscription[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await customObjectsApi.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions')
      if (response.body && (response.body as any).items) {
        return (response.body as any).items
      }
      return []
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteOperatorSubscription(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorSubscriptionReadyForApproval(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<InstallPlan> {
    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
        { fieldSelector: `metadata.name=${name}` },
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
        reject(`Timeout reached while waiting for "${name}" subscription is ready.`)
      }, timeout * 1000)
    })
  }

  async approveOperatorInstallationPlan(name: string, namespace: string) {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const patch: InstallPlan = {
        spec: {
          approved: true,
        },
      }
      await customObjectsApi.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'installplans', name, patch, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorInstallPlan(name: string, namespace: string, timeout = 240) {
    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/installplans`,
        { fieldSelector: `metadata.name=${name}` },
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
        reject(`Timeout reached while waiting for "${name}" has go status 'Installed'.`)
      }, timeout * 1000)
    })
  }

  async getCSV(name: string, namespace: string): Promise<ClusterServiceVersion | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name)
      return body as ClusterServiceVersion
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getCSVWithPrefix(namePrefix: string, namespace: string): Promise<ClusterServiceVersion[]> {
    try {
      const csvs = await this.listCSV(namespace)
      return csvs.items.filter(csv => csv.metadata.name!.startsWith(namePrefix))
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listCSV(namespace: string): Promise<ClusterServiceVersionList> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions')
      return body as ClusterServiceVersionList
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchClusterServiceVersion(name: string, namespace: string, jsonPatch: any[]): Promise<ClusterServiceVersion> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    const requestOptions = {
      headers: {
        'content-type': 'application/json-patch+json',
      },
    }
    try {
      const response = await customObjectsApi.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name, jsonPatch, undefined, undefined, undefined, requestOptions)
      return response.body as ClusterServiceVersion
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterServiceVersion(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteCrd(name: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.deleteCustomResourceDefinition(name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespace(namespace)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteCertificate(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If cluster certificates doesn't exist an exception will be thrown
      await customObjectsApi.deleteNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteIssuer(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createCertificate(certificate: V1Certificate, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      delete certificate.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', certificate)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCertificate(name: string, certificate: V1Certificate, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const response = await customObjectsApi.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name)
      certificate.metadata.resourceVersion = (response.body as any).metadata.resourceVersion

      delete certificate.metadata?.namespace
      await customObjectsApi.replaceNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name, certificate)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isCertificateExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createIssuer(issuer: any, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      delete issuer.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', issuer)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceIssuer(name: string, issuer: any, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const response = await customObjectsApi.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name)
      issuer.metadata.resourceVersion = (response.body as any).metadata.resourceVersion

      delete issuer.metadata?.namespace
      await customObjectsApi.replaceNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name, issuer)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIssuerExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async currentContext(): Promise<string> {
    return this.kubeConfig.getCurrentContext()
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
    } catch (e: any) {
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
    } catch (error: any) {
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
    } catch (error: any) {
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
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
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

  async isSecretExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedSecret(name, namespace)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }
      throw this.wrapK8sClientError(e)
    }
  }

  /**
   * Creates a secret with given name and data.
   * Data should not be base64 encoded.
   */
  async createSecret(name: string, namespace: string, data: { [key: string]: string }): Promise<V1Secret | undefined> {
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
   * Awaits secret to be present and contain non-empty data fields specified in dataKeys parameter.
   */
  async waitSecret(name: string, namespace: string, dataKeys: string[] = [], timeout = AWAIT_TIMEOUT_S): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/api/v1/namespaces/${namespace}/secrets/`, { fieldSelector: `metadata.name=${name}` },
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
        reject(`Timeout reached while waiting for "${name}" secret.`)
      }, timeout * 1000)

      // Request secret, for case if it is already exist
      const secret = await this.getSecret(name, namespace)
      if (secret) {
        // Stop watching
        request.abort()
        clearTimeout(timeoutHandler)

        // Relese awaiter
        resolve()
      }
    })
  }

  async deletePersistentVolumeClaim(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedPersistentVolumeClaim(name, namespace)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
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
    } catch (e: any) {
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
    } catch (e: any) {
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
