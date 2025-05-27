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
  AppsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  Log,
  NetworkingV1Api,
  PortForward,
  RbacAuthorizationV1Api,
  V1ClusterRole,
  V1ClusterRoleBinding,
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
  V1Secret,
  V1Service,
  V1ServiceAccount,
  V1ServiceList,
  Watch,
  V1CustomResourceDefinition, V1ValidatingWebhookConfiguration, V1MutatingWebhookConfiguration,
} from '@kubernetes/client-node'
import {Cluster} from '@kubernetes/client-node/dist/config_types'
import axios, {AxiosRequestConfig} from 'axios'
import {ux} from '@oclif/core'
import * as execa from 'execa'
import * as fs from 'node:fs'
import * as https from 'node:https'
import * as net from 'node:net'
import {Writable} from 'node:stream'
import {
  newError,
  sleep,
} from '../utils/utls'
import {CheCtlContext, KubeHelperContext} from '../context'
import {V1Certificate} from './types/cert-manager'
import {CatalogSource, ClusterServiceVersion, InstallPlan, Subscription} from './types/olm'
import {EclipseChe} from '../tasks/installers/eclipse-che/eclipse-che'
import {CheCluster} from './types/che-cluster'

export class KubeClient {
  private readonly kubeConfig

  private constructor(
    protected readonly podWaitTimeout: number,
    protected readonly podReadyTimeout: number) {
    this.kubeConfig = new KubeConfig()
    this.kubeConfig.loadFromDefault()
  }

  static getInstance(): KubeClient {
    const ctx = CheCtlContext.get()
    return new KubeClient(ctx[KubeHelperContext.POD_WAIT_TIMEOUT], ctx[KubeHelperContext.POD_READY_TIMEOUT])
  }

  getKubeConfig(): KubeConfig {
    return this.kubeConfig
  }

  getCurrentContext(): string {
    return this.kubeConfig.getCurrentContext()
  }

  async checkKubeApi() {
    const currentCluster = this.kubeConfig.getCurrentCluster()
    if (!currentCluster) {
      throw new Error('The current context is unknown.')
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
      }

      if (token) {
        config.headers = {
          Authorization: `Bearer ${token}`,
        }
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

  async applyResource(yamlPath: string, opts = ''): Promise<void> {
    const command = `kubectl apply -f ${yamlPath} ${opts}`
    await execa(command, {timeout: 60_000, shell: true})
  }

  async createNamespace(namespace: V1Namespace): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.createNamespace(namespace)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitNamespaceActive(name: string, intervalMs = 500, timeoutMs = 60_000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const namespace = await this.getNamespace(name)
      if (namespace && namespace.status && namespace.status.phase && namespace.status.phase === 'Active') {
        return
      }

      await ux.wait(intervalMs)
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

  async getServicesBySelector(labelSelector: string, namespace: string): Promise<V1ServiceList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService(namespace, undefined, undefined, undefined, undefined, labelSelector)
      return res.body
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
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

  async createServiceAccount(serviceAccount: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete serviceAccount.metadata?.namespace
      await k8sCoreApi.createNamespacedServiceAccount(namespace, serviceAccount)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceServiceAccount(name: string, serviceAccount: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedServiceAccount(name, namespace)
      serviceAccount.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion

      delete serviceAccount.metadata?.namespace
      await k8sCoreApi.replaceNamespacedServiceAccount(name, namespace, serviceAccount)
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

  async createRole(role: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete role.metadata?.namespace
      await k8sRbacAuthApi.createNamespacedRole(namespace, role)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRole(role: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete role.metadata?.namespace
      await k8sRbacAuthApi.replaceNamespacedRole(role.metadata!.name!, namespace, role)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRole(clusterRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRole(clusterRole)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRole(custerRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRole(custerRole.metadata!.name!, custerRole)
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
      const response = await k8sAdmissionApi.readValidatingWebhookConfiguration(name)
      webhook.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion
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

  async isMutatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readMutatingWebhookConfiguration(name)
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceVMutatingWebhookConfiguration(name: string, webhook: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const response = await k8sAdmissionApi.readMutatingWebhookConfiguration(name)
      webhook.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion
      await k8sAdmissionApi.replaceMutatingWebhookConfiguration(name, webhook)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createMutatingWebhookConfiguration(webhook: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createMutatingWebhookConfiguration(webhook)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
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

  async createRoleBinding(roleBinding: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete roleBinding.metadata?.namespace
      roleBinding.subjects![0].namespace = namespace
      await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, roleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBinding(roleBinding: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete roleBinding.metadata?.namespace
      roleBinding.subjects![0].namespace = namespace
      await k8sRbacAuthApi.replaceNamespacedRoleBinding(roleBinding.metadata!.name!, namespace, roleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBinding(clusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRoleBinding(clusterRoleBinding)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(clusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRoleBinding(clusterRoleBinding.metadata!.name!, clusterRoleBinding)
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
      const {body} = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      return body
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listConfigMaps(namespace: string, labelSelector?: string): Promise<V1ConfigMap[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const {body} = await k8sCoreApi.listNamespacedConfigMap(namespace, undefined, undefined, undefined, undefined, labelSelector)
      return body.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getConfigMapValue(name: string, namespace: string, key: string): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const {body} = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
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
      const {body} = await k8sApi.readNamespace(namespace)
      return body
    } catch {}
  }

  async patchNamespacedCustomObject(name: string, namespace: string, patch: any, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
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

  async getClusterCustomObject(group: string, version: string, plural: string, name: any): Promise<any> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await k8sCoreApi.getClusterCustomObject(group, version, plural, name)
      return body
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createClusterCustomObject(group: string, version: string, plural: string, body: any): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await k8sCoreApi.createClusterCustomObject(group, version, plural, body)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterCustomObject(group: string, version: string, plural: string, name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await k8sCoreApi.deleteClusterCustomObject(group, version, plural, name)
      ux.debug(`Deleted ${plural}.${version}.${group} ${name} resource`)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

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

  async getPodReadyConditionStatus(selector: string, namespace: string, allowMultiple: boolean): Promise<string | undefined> {
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

    if (!allowMultiple && res.body.items.length > 1) {
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

  async waitForPodReady(selector: string, namespace: string, allowMultiple = false, intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const readyStatus = await this.getPodReadyConditionStatus(selector, namespace, allowMultiple)
      if (readyStatus === 'True') {
        return
      }

      await ux.wait(intervalMs)
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

      await ux.wait(intervalMs)
    }

    throw new Error('ERR_TIMEOUT: Waiting until pod is deleted took too long.')
  }

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
        await ux.wait(intervalMs)
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

  async replaceConfigMap(name: string, configMap: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      configMap.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion

      delete configMap.metadata?.namespace
      await k8sCoreApi.replaceNamespacedConfigMap(name, namespace, configMap)
    } catch (e: any) {
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

  async createDeployment(deployment: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      delete deployment.metadata?.namespace
      await k8sAppsApi.createNamespacedDeployment(namespace, deployment)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
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

  async createService(service: V1Service, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete service.metadata?.namespace
      await k8sApi.createNamespacedService(namespace, service)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deletePod(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.deleteNamespacedPod(name, namespace)
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceDeployment(name: string, deployment: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)

    deployment.spec!.template!.metadata!.annotations = deployment.spec!.template!.metadata!.annotations || {}
    deployment.spec!.template!.metadata!.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString()
    delete deployment.metadata?.namespace

    try {
      await k8sAppsApi.replaceNamespacedDeployment(name, namespace, deployment)
    } catch (e: any) {
      if (e.response && e.response.body && e.response.body.message && e.response.body.message.toString().endsWith('field is immutable')) {
        try {
          await k8sAppsApi.deleteNamespacedDeployment(name, namespace)
          await k8sAppsApi.createNamespacedDeployment(namespace, deployment)
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

  async createIngress(ingress: V1Ingress, namespace: string): Promise<void> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      delete ingress.metadata?.namespace
      await networkingV1Api.createNamespacedIngress(namespace, ingress)
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

  async createCustomResourceDefinition(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.createCustomResourceDefinition(crd)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCustomResourceDefinition(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      if (!crd.metadata!.resourceVersion) {
        const response = await k8sApi.readCustomResourceDefinition(crd.metadata!.name!)
        crd.metadata!.resourceVersion = (response.body as any).metadata.resourceVersion
      }

      await k8sApi.replaceCustomResourceDefinition(crd.metadata!.name!, crd)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getCustomResourceDefinition(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const {body} = await k8sApi.readCustomResourceDefinition(name)
      return body
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getCheCluster(namespace: string): Promise<CheCluster | undefined> {
    const cheClusters = await this.getAllCheClusters()
    return cheClusters.find(c => c.metadata.namespace === namespace)
  }

  async getAllCheClusters(): Promise<any[]> {
    for (let i = 0; i < 30; i++) {
      try {
        return await this.listClusterCustomObject(EclipseChe.CHE_CLUSTER_API_GROUP, EclipseChe.CHE_CLUSTER_API_VERSION_V2, EclipseChe.CHE_CLUSTER_KIND_PLURAL)
      } catch (e: any) {
        if (this.isWebhookAvailabilityError(e)) {
          await sleep(5 * 1000)
        } else {
          throw e
        }
      }
    }

    return []
  }

  isCheClusterAPIV2(checluster: any): boolean {
    return checluster.apiVersion === `${EclipseChe.CHE_CLUSTER_API_GROUP}/${EclipseChe.CHE_CLUSTER_API_VERSION_V2}`
  }

  async deleteAllCustomResourcesAndCrd(crdName: string, apiGroup: string, version: string, plural: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    const crd = await this.getCustomResourceDefinition(crdName)
    if (!crd) {
      return
    }

    // 1. Disable conversion webhook
    crd.spec.conversion = null

    // 2. Patch CRD to unblock potential invalid resource error
    for (let i = 0; i < crd.spec.versions.length; i++) {
      if (crd.spec.versions[i].schema?.openAPIV3Schema?.properties?.spec) {
        crd.spec.versions[i].schema.openAPIV3Schema.properties.spec = {type: 'object', properties: {}}
      }
    }

    await this.replaceCustomResourceDefinition(crd)

    // 3. Delete resources
    let resources = await this.listClusterCustomObject(apiGroup, version, plural)
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await customObjectsApi.deleteNamespacedCustomObject(apiGroup, version, namespace, plural, name, 60)
      } catch {
        // ignore, check existence later
      }
    }

    // wait and check
    for (let i = 0; i < 12; i++) {
      const resources = await this.listClusterCustomObject(apiGroup, version, plural)
      if (resources.length === 0) {
        break
      }

      await ux.wait(5000)
    }

    // 4. Remove finalizers
    resources = await this.listClusterCustomObject(apiGroup, version, plural)
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await this.patchNamespacedCustomObject(name, namespace, {metadata: {finalizers: null}}, apiGroup, version, plural)
      } catch (error: any) {
        if (error.cause?.body?.reason === 'NotFound') {
          continue
        }

        throw error
      }
    }

    // 5. Remove CRD
    await this.deleteCustomResourceDefinition(crdName)
    resources = await this.listClusterCustomObject(apiGroup, version, plural)
    if (resources.length !== 0) {
      throw new Error(`Failed to remove Custom Resources: ${plural}${apiGroup}, ${resources.length} resource(s) left.`)
    }
  }

  async createNamespacedCustomObject(namespace: string, group: string, version: string, plural: string, body: any, handleWebhookAvailabilityError: boolean): Promise<void> {
    if (body.apiVersion !== `${group}/${version}`) {
      throw new Error(`${body.metadata.name} Custom Object must be ${group}/${version} version`)
    }

    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    delete body.metadata?.namespace
    if (!handleWebhookAvailabilityError) {
      try {
        await k8sCoreApi.createNamespacedCustomObject(group, version, namespace, plural, body)
      } catch (e: any) {
        throw this.wrapK8sClientError(e)
      }
    } else {
      for (let i = 0; i < 30; i++) {
        try {
          await k8sCoreApi.createNamespacedCustomObject(group, version, namespace, plural, body)
          return
        } catch (e: any) {
          const wrappedError = this.wrapK8sClientError(e)
          if (this.isWebhookAvailabilityError(wrappedError)) {
            await sleep(5 * 1000)
          } else {
            throw wrappedError
          }
        }
      }
    }
  }

  async listNamespacedCustomObject(
    resourceAPIGroup: string,
    resourceAPIVersion: string,
    namespace: string,
    resourcePlural: string): Promise<any[]> {
    return this.list(resourceAPIGroup, resourceAPIVersion, namespace, resourcePlural)
  }

  async listClusterCustomObject(resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any[]> {
    return this.list(resourceAPIGroup, resourceAPIVersion, undefined, resourcePlural)
  }

  async list(
    resourceAPIGroup: string,
    resourceAPIVersion: string,
    namespace: string | undefined,
    resourcePlural: string): Promise<any[]> {
    let errMsg = ''
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        if (namespace === undefined) {
          // If namespace is not specified, list cluster custom objects
          const {body} = await customObjectsApi.listClusterCustomObject(
            resourceAPIGroup,
            resourceAPIVersion,
            resourcePlural)
          return (body as any).items ? (body as any).items : []
        } else {
          // If namespace is specified, list namespaced custom objects
          const {body} = await customObjectsApi.listNamespacedCustomObject(
            resourceAPIGroup,
            resourceAPIVersion,
            namespace,
            resourcePlural)
          return (body as any).items ? (body as any).items : []
        }
      } catch (e: any) {
        if (e.response?.statusCode === 404) {
          return []
        }

        const wrappedError = this.wrapK8sClientError(e)
        errMsg = wrappedError.message as string
        if (this.isStorageIsReInitializingError(wrappedError) || this.isTooManyRequestsError(wrappedError)) {
          await ux.wait(1000)
          continue
        }

        throw wrappedError
      }
    }

    throw new Error(`Exceeded maximum retry attempts to list cluster custom object: ${errMsg}`)
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

  async getCatalogSource(name: string, namespace: string): Promise<CatalogSource | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
      return body as CatalogSource
    } catch (e: any) {
      if (e.response && e.response.statusCode === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createCatalogSource(catalogSource: CatalogSource, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      delete catalogSource.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', catalogSource)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitCatalogSource(name: string, namespace: string): Promise<CatalogSource> {
    return this.waitAndRetryOnError(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/catalogsources`,
      `metadata.name=${name}`,
      (obj: any | undefined) => {
        if (obj) {
          return obj
        }
      },
      `Timeout reached while waiting for "${name}" catalog source is created.`,
      60
    )
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

  async createOperatorSubscription(subscription: Subscription, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      delete subscription.metadata.namespace
      await customObjectsApi.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', subscription)
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getOperatorSubscriptionByPackageInNamespace(packageName: string, namespace: string): Promise<Subscription | undefined> {
    const subs = await this.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions')
    return (subs as Subscription[]).find(sub => sub.spec.name === packageName)
  }

  async getOperatorSubscription(name: string, namespace: string): Promise<Subscription | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
      return body as Subscription
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async waitInstalledCSVInSubscription(name: string, namespace: string): Promise<string> {
    return this.waitAndRetryOnError(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
      `metadata.name=${name}`,
      (obj: any | undefined) => {
        if (obj) {
          const subscription = obj as Subscription
          return subscription.status?.installedCSV
        }
      },
      `Timeout reached while waiting for installed CSV of '${name}' subscription.`,
      30
    )
  }

  async waitCSVStatusPhase(name: string, namespace: string): Promise<string> {
    return this.waitAndRetryOnError(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/clusterserviceversions`,
      `metadata.name=${name}`,
      (obj: any | undefined) => {
        if (obj) {
          const csv = obj as ClusterServiceVersion
          return csv.status?.phase
        }
      },
      `Timeout reached while waiting CSV '${name}' status.`,
      30)
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

  async waitOperatorSubscriptionReadyForApproval(name: string, namespace: string): Promise<InstallPlan> {
    return this.waitAndRetryOnError(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
      `metadata.name=${name}`,
      (obj: any | undefined) => {
        if (obj) {
          const subscription = obj as Subscription
          if (subscription?.status?.installplan) {
            return subscription.status.installplan
          }
        }
      },
      `Timeout reached while waiting for "${name}" subscription is ready.`,
      120,
    )
  }

  async approveOperatorInstallationPlan(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const patch: InstallPlan = {
        spec: {
          approved: true,
        },
      }
      await customObjectsApi.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'installplans', name, patch, undefined, undefined, undefined, {headers: {'Content-Type': 'application/merge-patch+json'}})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorInstallPlan(name: string, namespace: string) {
    return this.waitAndRetryOnError(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/installplans`,
      `metadata.name=${name}`,
      (obj: any | undefined) => {
        if (obj) {
          const installPlan = obj as InstallPlan
          if (installPlan.status?.phase === 'Failed') {
            const errorMessage = []
            for (const condition of installPlan.status.conditions) {
              if (!condition.reason) {
                errorMessage.push(`Reason: ${condition.reason}`, !condition.message ? `Message: ${condition.message}` : '')
              }
            }

            throw new Error(errorMessage.join(' '))
          }

          if (installPlan.status?.conditions) {
            for (const condition of installPlan.status.conditions) {
              if (condition.type === 'Installed' && condition.status === 'True') {
                return installPlan
              }
            }
          }
        }
      },
      `Timeout reached while waiting for "${name}" has go status 'Installed'.`,
      60,
    )
  }

  async getCSV(name: string, namespace: string): Promise<ClusterServiceVersion | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const {body} = await customObjectsApi.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name)
      return body as ClusterServiceVersion
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getCSVWithPrefix(namePrefix: string, namespace: string): Promise<ClusterServiceVersion[]> {
    const csvs = await this.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions')
    return (csvs as ClusterServiceVersion[]).filter(csv => csv.metadata.name!.startsWith(namePrefix))
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

  async deleteCustomResourceDefinition(name: string): Promise<void> {
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
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
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

  async deleteOperator(name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteClusterCustomObject('operators.coreos.com', 'v1', 'operators', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteLease(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject('coordination.k8s.io', 'v1', namespace, 'leases', name)
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
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
      return res && res.body && res.body ? res.body : undefined
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
  async waitSecret(name: string, namespace: string, dataKeys: string[] = []): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/api/v1/namespaces/${namespace}/secrets/`, {fieldSelector: `metadata.name=${name}`}, (_phase: string, obj: any) => {
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
      }, error => {
        if (error) {
          reject(error)
        }
      })

      // Automatically stop watching after timeout
      const timeoutHandler = setTimeout(() => {
        request.abort()
        reject(`Timeout reached while waiting for "${name}" secret.`)
      }, 30 * 1000)

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

  async listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, fieldSelector, labelSelector)
      return res && res.body ? res.body : {
        items: [],
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
        fs.appendFileSync(filename, chunk, {encoding})
        done()
      }

      await logHelper.log(namespace, pod, container, stream, error => {
        stream.end()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }, {follow})
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

  async wait(
    path: string,
    fieldSelector: string,
    processObj: (obj: any) => any | undefined,
    errMsg: string,
    timeout: number): Promise<any> {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(
        path,
        {fieldSelector},
        (_phase: string, obj: unknown) => {
          const result = processObj(obj)
          if (result) {
            request.response.destroy()
            resolve(result)
          }
        },
        error => {
          if (timeoutHandler) {
            clearTimeout(timeoutHandler)
          }

          if (error) {
            reject(error)
          }
        })

      timeoutHandler = setTimeout(() => {
        request.abort()
        reject(errMsg)
      }, timeout * 1000)
    })
  }

  async waitAndRetryOnError(path: string,
    fieldSelector: string,
    processObj: (obj: any) => any | undefined,
    errMsg: string,
    timeout: number): Promise<any> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await this.wait(path, fieldSelector, processObj, errMsg, timeout)
      } catch (e: any) {
        const wrappedError = this.wrapK8sClientError(e)
        if (this.isTooManyRequestsError(wrappedError)) {
          await ux.wait(2000)
          continue
        }

        throw wrappedError
      }
    }

    throw new Error('Exceeded maximum retry attempts: TooManyRequests Error')
  }

  private wrapK8sClientError(e: any): Error {
    if (e.response && e.response.body) {
      if (e.response.body.message) {
        return newError(e.response.body.message, e)
      }

      return newError(e.response.body, e)
    }

    return e
  }

  private isWebhookAvailabilityError(error: any): boolean {
    const msg = error.message as string
    return msg.includes(`service "${EclipseChe.CHE_FLAVOR}-operator-service" not found`) ||
      msg.includes(`no endpoints available for service "${EclipseChe.CHE_FLAVOR}-operator-service"`) ||
      msg.includes('failed calling webhook') ||
      msg.includes('conversion webhook')
  }

  private isStorageIsReInitializingError(error: any): boolean {
    const msg = error.message as string
    return msg.includes('storage is (re)initializing')
  }

  private isTooManyRequestsError(error: any): boolean {
    const msg = error.message as string
    return msg.includes('TooManyRequests')
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
