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
import { Cluster } from '@kubernetes/client-node/dist/config_types'
import axios, { AxiosRequestConfig } from 'axios'
import { ux } from '@oclif/core'
import * as execa from 'execa'
import * as fs from 'node:fs'
import * as https from 'node:https'
import * as net from 'node:net'
import { Writable } from 'node:stream'
import {
  newError,
  sleep,
} from '../utils/utls'
import { CheCtlContext, KubeHelperContext } from '../context'
import { V1Certificate } from './types/cert-manager'
import { CatalogSource, ClusterServiceVersion, InstallPlan, Subscription } from './types/olm'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'
import { CheCluster } from './types/che-cluster'

const AWAIT_TIMEOUT_S = 30

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
        config.headers = { Authorization: 'Bearer ' + token }
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
    const namespace = 'default'
    const saName = 'default'

    let secretList
    try {
      secretList = await k8sCoreApi.listNamespacedSecret({ namespace })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!secretList.items || secretList.items.length === 0) {
      throw new Error(`Unable to get default service account token since there is no secret in '${namespace}' namespace`)
    }

    const v1DefaultSATokenSecret = secretList.items.find(secret => secret.metadata!.annotations &&
      secret.metadata!.annotations['kubernetes.io/service-account.name'] === saName &&
      secret.type === 'kubernetes.io/service-account-token')

    if (!v1DefaultSATokenSecret) {
      throw new Error(`Secret for '${saName}' service account is not found in namespace '${namespace}'`)
    }

    return Buffer.from(v1DefaultSATokenSecret.data!.token, 'base64').toString()
  }

  async applyResource(yamlPath: string, opts = ''): Promise<void> {
    const command = `kubectl apply -f ${yamlPath} ${opts}`
    await execa(command, { timeout: 60_000, shell: true })
  }

  async createNamespace(body: V1Namespace): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.createNamespace({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitNamespaceActive(name: string, intervalMs = 500, timeoutMs = 60_000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const namespace = await this.getNamespace(name)
      if (namespace?.status?.phase === 'Active') {
        return
      }

      await ux.wait(intervalMs)
    }

    throw new Error(`Namespace '${name}' is not in 'Active' phase.`)
  }

  async deleteService(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.deleteNamespacedService({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getServicesBySelector(labelSelector: string, namespace: string): Promise<V1ServiceList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.listNamespacedService({ namespace, labelSelector })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isServiceAccountExist(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedServiceAccount({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async deleteServiceAccount(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedServiceAccount({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createServiceAccount(body: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sCoreApi.createNamespacedServiceAccount({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceServiceAccount(name: string, body: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedServiceAccount({ name, namespace })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      body.metadata!.namespace = namespace
      await k8sCoreApi.replaceNamespacedServiceAccount({ name, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRole({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async isClusterRoleExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRole({ name })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async createRole(body: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sRbacAuthApi.createNamespacedRole({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRole(body: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sRbacAuthApi.replaceNamespacedRole({ name: body.metadata!.name!, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRole(body: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRole({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRole(body: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRole({ name: body.metadata!.name!, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRole(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteNamespacedRole({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPodListByLabel(namespace: string, labelSelector: string): Promise<V1Pod[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { items } = await k8sCoreApi.listNamespacedPod({ namespace, labelSelector })
      return items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteClusterRole({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isRoleBindingExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRoleBinding({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async isValidatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readValidatingWebhookConfiguration({ name })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async replaceValidatingWebhookConfiguration(name: string, body: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const response = await k8sAdmissionApi.readValidatingWebhookConfiguration({ name })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      await k8sAdmissionApi.replaceValidatingWebhookConfiguration({ name, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createValidatingWebhookConfiguration(body: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createValidatingWebhookConfiguration({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteValidatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteValidatingWebhookConfiguration({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isMutatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readMutatingWebhookConfiguration({ name })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async replaceVMutatingWebhookConfiguration(name: string, body: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const response = await k8sAdmissionApi.readMutatingWebhookConfiguration({ name })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      await k8sAdmissionApi.replaceMutatingWebhookConfiguration({ name, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createMutatingWebhookConfiguration(body: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createMutatingWebhookConfiguration({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteMutatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteMutatingWebhookConfiguration({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isClusterRoleBindingExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRoleBinding({ name })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async createRoleBinding(body: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      body.metadata!.namespace = namespace
      body.subjects![0].namespace = namespace
      await k8sRbacAuthApi.createNamespacedRoleBinding({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBinding(body: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      body.metadata!.namespace = namespace
      body.subjects![0].namespace = namespace
      await k8sRbacAuthApi.replaceNamespacedRoleBinding({ name: body.metadata!.name!, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBinding(body: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRoleBinding({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(body: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRoleBinding({ name: body.metadata!.name!, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRoleBinding(name: string, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteNamespacedRoleBinding({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteClusterRoleBinding(name: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteClusterRoleBinding({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getConfigMap(name: string, namespace: string): Promise<V1ConfigMap | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.readNamespacedConfigMap({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listConfigMaps(namespace: string, labelSelector?: string): Promise<V1ConfigMap[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const { items } = await k8sCoreApi.listNamespacedConfigMap({ namespace, labelSelector })
      return items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getConfigMapValue(name: string, namespace: string, key: string): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const cm = await k8sCoreApi.readNamespacedConfigMap({ name, namespace })
      return cm.data?.[key]
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  public async createSecret(body: V1Secret, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sCoreApi.createNamespacedSecret({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  public async createConfigMap(body: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sCoreApi.createNamespacedConfigMap({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConfigMap(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedConfigMap({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteSecret(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedSecret({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getNamespace(name: string): Promise<V1Namespace | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sApi.readNamespace({ name })
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
      if (pod.status?.phase === desiredPhase && pod.status?.containerStatuses) {
        for (const status of pod.status.containerStatuses) {
          if (status.state?.waiting?.message && status.state?.waiting?.reason) {
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
      if (pod.status?.containerStatuses) {
        for (const status of pod.status.containerStatuses) {
          if (status.lastState) {
            return status.lastState.terminated
          }
        }
      }
    }
  }

  async getPodCondition(namespace: string, labelSelector: string, conditionType: string): Promise<V1PodCondition[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let pods
    try {
      const res = await k8sCoreApi.listNamespacedPod({ namespace, labelSelector })
      pods = res.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    const conditions: V1PodCondition[] = []
    for (const item of pods) {
      if (item.status && item.status.conditions) {
        for (const condition of item.status.conditions) {
          if (condition.type === conditionType) {
            conditions.push(condition)
          }
        }
      }
    }

    return conditions
  }

  async getPodReadyConditionStatus(labelSelector: string, namespace: string, allowMultiple: boolean): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    let pods
    try {
      const res = await k8sCoreApi.listNamespacedPod({ namespace, labelSelector })
      pods = res.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (pods.length < 1) {
      // No pods found by the specified labelSelector. So, it's not ready.
      return 'False'
    }

    if (!allowMultiple && pods.length > 1) {
      // Several pods found, rolling update?
      return
    }

    if (!pods[0].status || !pods[0].status.conditions || !(pods[0].status.conditions.length > 0)) {
      return
    }

    const conditions = pods[0].status.conditions
    for (const condition of conditions) {
      if (condition.type === 'Ready') {
        return condition.status
      }
    }
  }

  async waitForPodReady(labelSelector: string, namespace: string, allowMultiple = false, intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const readyStatus = await this.getPodReadyConditionStatus(labelSelector, namespace, allowMultiple)
      if (readyStatus === 'True') {
        return
      }

      await ux.wait(intervalMs)
    }

    throw new Error(`ERR_TIMEOUT: Timeout set to pod ready timeout ${this.podReadyTimeout}`)
  }

  async waitUntilPodIsDeleted(labelSelector: string, namespace: string, intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const pods = await this.listNamespacedPod(namespace, undefined, labelSelector)
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
      await k8sApi.readNamespacedDeployment({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response && e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async replaceConfigMap(name: string, body: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedConfigMap({ name, namespace })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      body.metadata!.namespace = namespace
      await k8sCoreApi.replaceNamespacedConfigMap({ name, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isConfigMapExists(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedConfigMap({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async scaleDeployment(name: string, namespace: string, replicas: number) {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    const body = {
      spec: {
        replicas,
      },
    }

    try {
      await k8sAppsApi.patchNamespacedDeploymentScale({ name, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createDeployment(body: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sAppsApi.createNamespacedDeployment({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceService(name: string, body: V1Service, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedService({ name, namespace })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      body.metadata!.namespace = namespace
      await k8sCoreApi.replaceNamespacedService({ name, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isServiceExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedService({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async createService(body: V1Service, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      body.metadata!.namespace = namespace
      await k8sApi.createNamespacedService({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deletePod(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.deleteNamespacedPod({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async replaceDeployment(name: string, body: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)

    body.spec!.template!.metadata!.annotations = body.spec!.template!.metadata!.annotations || {}
    body.spec!.template!.metadata!.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString()
    body.metadata!.namespace = namespace

    try {
      await k8sAppsApi.replaceNamespacedDeployment({ name, namespace, body })
    } catch (e: any) {
      if (e.response?.body?.message && e.response.body.message.toString().endsWith('field is immutable')) {
        try {
          await k8sAppsApi.deleteNamespacedDeployment({ name, namespace })
          await k8sAppsApi.createNamespacedDeployment({ namespace, body })
        } catch (e: any) {
          throw this.wrapK8sClientError(e)
        }
      } else {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteDeployment(name: string, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteNamespacedDeployment({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getDeployment(name: string, namespace: string): Promise<V1Deployment | undefined> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      return await k8sAppsApi.readNamespacedDeployment({ name, namespace })
    } catch (error: any) {
      if (error.response.statusCode !== 404) {
        throw this.wrapK8sClientError(error)
      }
    }
  }

  async createIngress(body: V1Ingress, namespace: string): Promise<void> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      body.metadata!.namespace = namespace
      await networkingV1Api.createNamespacedIngress({ namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIngressExist(name: string, namespace: string): Promise<boolean> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      await networkingV1Api.readNamespacedIngress({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return false
    }
  }

  async createCustomResourceDefinition(body: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.createCustomResourceDefinition({ body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCustomResourceDefinition(body: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const response = await k8sApi.readCustomResourceDefinition({ name: body.metadata!.name! })
      body.metadata!.resourceVersion = response.metadata!.resourceVersion
      await k8sApi.replaceCustomResourceDefinition({ name: body.metadata!.name!, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getCustomResourceDefinition(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      return await k8sApi.readCustomResourceDefinition({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }

      return
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

  async deleteAllCustomResourcesAndCrd(name: string, group: string, version: string, plural: string): Promise<void> {
    const crd = await this.getCustomResourceDefinition(name)
    if (!crd) {
      return
    }

    // 1. Disable conversion webhook
    crd.spec.conversion = null

    // 2. Patch CRD to unblock potential invalid resource error
    for (let i = 0; i < crd.spec.versions.length; i++) {
      if (crd.spec.versions[i].schema?.openAPIV3Schema?.properties?.spec) {
        crd.spec.versions[i].schema.openAPIV3Schema.properties.spec = { type: 'object', properties: {} }
      }
    }

    await this.replaceCustomResourceDefinition(crd)

    // 3. Delete resources
    let resources = await this.listClusterCustomObject(group, version, plural)
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await this.deleteNamespacedCustomObject(group, version, namespace, plural, name)
      } catch {
        // ignore, check existence later
      }
    }

    // wait and check
    for (let i = 0; i < 12; i++) {
      const resources = await this.listClusterCustomObject(group, version, plural)
      if (resources.length === 0) {
        break
      }

      await ux.wait(5000)
    }

    // 4. Remove finalizers
    resources = await this.listClusterCustomObject(group, version, plural)
    for (const resource of resources) {
      const name = resource.metadata.name
      const namespace = resource.metadata.namespace
      try {
        await this.patchNamespacedCustomObject(group, version, namespace, plural, name, { metadata: { finalizers: null } })
      } catch (error: any) {
        if (error.cause?.body?.reason === 'NotFound') {
          continue
        }

        throw error
      }
    }

    // 5. Remove CRD
    await this.deleteCustomResourceDefinition(name)
    resources = await this.listClusterCustomObject(group, version, plural)
    if (resources.length !== 0) {
      throw new Error(`Failed to remove Custom Resources: ${plural}${group}, ${resources.length} resource(s) left.`)
    }
  }

  async createCheClusterObject(namespace: string, body: any, handleWebhookAvailabilityError: boolean): Promise<void> {
    if (body.apiVersion !== `${EclipseChe.CHE_CLUSTER_API_GROUP}/${EclipseChe.CHE_CLUSTER_API_VERSION_V2}`) {
      throw new Error(`${body.metadata.name} Custom Object must be ${EclipseChe.CHE_CLUSTER_API_GROUP}/${EclipseChe.CHE_CLUSTER_API_VERSION_V2} version`)
    }

    const group = EclipseChe.CHE_CLUSTER_API_GROUP
    const version = EclipseChe.CHE_CLUSTER_API_VERSION_V2
    const plural = EclipseChe.CHE_CLUSTER_KIND_PLURAL
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    delete body.metadata?.namespace
    if (!handleWebhookAvailabilityError) {
      try {
        await k8sCoreApi.createNamespacedCustomObject({ group, version, namespace, plural, body })
      } catch (e: any) {
        throw this.wrapK8sClientError(e)
      }
    } else {
      for (let i = 0; i < 30; i++) {
        try {
          await k8sCoreApi.createNamespacedCustomObject({ group, version, namespace, plural, body })
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

  async isCatalogSourceExists(name: string, namespace: string): Promise<boolean> {
    const obj = await this.getCatalogSource(name, namespace)
    return obj !== undefined
  }

  async getCatalogSource(name: string, namespace: string): Promise<CatalogSource | undefined> {
    return this.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
  }

  async createCatalogSource(catalogSource: CatalogSource, namespace: string): Promise<void> {
    return this.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', catalogSource)
  }

  async waitCatalogSource(name: string, namespace: string, timeout = 60): Promise<CatalogSource> {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<CatalogSource>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/catalogsources`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: any) => {
          request.abort()
          resolve(obj as CatalogSource)
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
        reject(`Timeout reached while waiting for "${name}" catalog source is created.`)
      }, timeout * 1000)
    })
  }

  async deleteCatalogSource(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'catalogsources', name)
  }

  async createOperatorSubscription(body: Subscription, namespace: string): Promise<void> {
    return this.createNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', body)
  }

  async getOperatorSubscriptionByPackage(packageName: string, namespace: string): Promise<Subscription | undefined> {
    const items = await this.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions')
    return items.find(item => item.spec.name === packageName)
  }

  async getOperatorSubscription(name: string, namespace: string): Promise<Subscription | undefined> {
    return this.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
  }

  async waitInstalledCSVInSubscription(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<string> {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<string>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: unknown) => {
          const subscription = obj as Subscription
          if (subscription.status?.installedCSV) {
            request.abort()
            resolve(subscription.status.installedCSV)
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
        reject(`Timeout reached while waiting for installed CSV of '${name}' subscription.`)
      }, timeout * 1000)
    })
  }

  async waitCSVStatusPhase(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<string> {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<string>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/clusterserviceversions`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: any) => {
          const csv = obj as ClusterServiceVersion
          if (csv.status?.phase) {
            request.abort()
            resolve(csv.status.phase)
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
        reject(`Timeout reached while waiting CSV '${name}' status.`)
      }, timeout * 1000)
    })
  }

  async deleteOperatorSubscription(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'subscriptions', name)
  }

  async waitOperatorSubscriptionReadyForApproval(name: string, namespace: string, timeout = AWAIT_TIMEOUT_S): Promise<InstallPlan> {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: unknown) => {
          const subscription = obj as Subscription
          if (subscription.status?.installplan) {
            request.abort()
            resolve(subscription.status.installplan)
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
        reject(`Timeout reached while waiting for "${name}" subscription is ready.`)
      }, timeout * 1000)
    })
  }

  async approveOperatorInstallationPlan(name: string, namespace: string): Promise<void> {
    const patch: any = {
      spec: {
        approved: true,
      },
    }
    return this.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'installplans', name, patch)
  }

  async waitOperatorInstallPlan(name: string, namespace: string, timeout = 240) {
    let timeoutHandler: NodeJS.Timeout

    return new Promise<InstallPlan>(async (resolve, reject) => {
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher.watch(`/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/installplans`,
        { fieldSelector: `metadata.name=${name}` },
        (_phase: string, obj: any) => {
          const installPlan = obj as InstallPlan
          if (installPlan.status?.phase === 'Failed') {
            const errorMessage = []
            for (const condition of installPlan.status.conditions) {
              if (!condition.reason) {
                errorMessage.push(`Reason: ${condition.reason}`, !condition.message ? `Message: ${condition.message}` : '')
              }
            }

            request.abort()
            reject(errorMessage.join(' '))
          }

          if (installPlan.status?.conditions) {
            for (const condition of installPlan.status.conditions) {
              if (condition.type === 'Installed' && condition.status === 'True') {
                request.abort()
                resolve(installPlan)
              }
            }
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
        reject(`Timeout reached while waiting for "${name}" has go status 'Installed'.`)
      }, timeout * 1000)
    })
  }

  async getCSV(name: string, namespace: string): Promise<ClusterServiceVersion | undefined> {
    return this.getNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name)
  }

  async getCSVWithPrefix(namePrefix: string, namespace: string): Promise<ClusterServiceVersion[]> {
    try {
      const items = await this.listCSV(namespace)
      return items.filter(item => item.metadata.name!.startsWith(namePrefix))
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listCSV(namespace: string): Promise<ClusterServiceVersion[]> {
    return this.listNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions')
  }

  async patchClusterServiceVersion(name: string, namespace: string, jsonPatch: any): Promise<void> {
    return this.patchNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name, jsonPatch)
  }

  async deleteClusterServiceVersion(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('operators.coreos.com', 'v1alpha1', namespace, 'clusterserviceversions', name)
  }

  async deleteCustomResourceDefinition(name: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.deleteCustomResourceDefinition({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteNamespace(name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespace({ name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteCertificate(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name)
  }

  async deleteIssuer(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name)
  }

  async createCertificate(body: V1Certificate, namespace: string): Promise<void> {
    return this.createNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', body)
  }

  async replaceCertificate(name: string, body: V1Certificate, namespace: string): Promise<void> {
    return this.replaceNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name, body)
  }

  async isCertificateExists(name: string, namespace: string): Promise<boolean> {
    const obj = this.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'certificates', name)
    return obj !== undefined
  }

  async createIssuer(issuer: any, namespace: string): Promise<void> {
    return this.createNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', issuer)
  }

  async replaceIssuer(name: string, body: any, namespace: string): Promise<void> {
    return this.replaceNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name, body)
  }

  async isIssuerExists(name: string, namespace: string): Promise<boolean> {
    const obj = await this.getNamespacedCustomObject('cert-manager.io', 'v1', namespace, 'issuers', name)
    return obj !== undefined
  }

  async deleteOperator(name: string): Promise<void> {
    return this.deleteClusterCustomObject('operators.coreos.com', 'v1', 'operators', name)
  }

  async deleteLease(name: string, namespace: string): Promise<void> {
    return this.deleteNamespacedCustomObject('coordination.k8s.io', 'v1', namespace, 'leases', name)
  }

  async getClusterCustomObject(group: string, version: string, plural: string, name: any): Promise<any> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await k8sCoreApi.getClusterCustomObject({ group, version, plural, name })
      return body
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getNamespacedCustomObject(group: string, version: string, namespace: string, plural: string, name: string): Promise<any> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      return await customObjectsApi.getNamespacedCustomObject({ group, version, plural, namespace, name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createNamespacedCustomObject(group: string, version: string, namespace: string, plural: string, body: any): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      body.metadata.namespace = namespace
      await customObjectsApi.createNamespacedCustomObject({ group, version, plural, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterCustomObject(group: string, version: string, plural: string, body: any): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await k8sCoreApi.createClusterCustomObject({ group, version, plural, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceNamespacedCustomObject(group: string, version: string, namespace: string, plural: string, name: string, body: any): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const response = await customObjectsApi.getNamespacedCustomObject({ group, version, plural, name, namespace })
      body.metadata.resourceVersion = response.metadata!.resourceVersion
      body.metadata.namespace = namespace
      await customObjectsApi.replaceNamespacedCustomObject({ group, version, plural, name, namespace, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterCustomObject(group: string, version: string, plural: string, name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteClusterCustomObject({ group, version, plural, name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteNamespacedCustomObject(group: string, version: string, namespace: string, plural: string, name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject({ group, version, namespace, plural, name })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listNamespacedCustomObject(group: string, version: string, namespace: string, plural: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { items } = await customObjectsApi.listNamespacedCustomObject({ group, version, namespace, plural })
      return items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listClusterCustomObject(group: string, version: string, plural: string): Promise<any[]> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const { items } = await customObjectsApi.listClusterCustomObject({ group, version, plural })
      return items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchNamespacedCustomObject(group: string, version: string, namespace: string, plural: string, name: string, body: any): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    // const requestOptions = {
    //   headers: {
    //     'content-type': 'application/json-patch+json',
    //   },
    // }
    try {
      await customObjectsApi.patchNamespacedCustomObject({ group, version, namespace, plural, name, body })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getIngressHost(name: string, namespace: string): Promise<string | undefined> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      const res = await networkingV1Api.readNamespacedIngress({ name, namespace })
      if (res.spec?.rules && res.spec.rules.length > 0) {
        return res.spec.rules[0].host
      }
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getSecret(name: string, namespace: string): Promise<V1Secret | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      return await k8sCoreApi.readNamespacedSecret({ name, namespace })
    } catch (e: any) {
      if (e.response.statusCode !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isSecretExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)

    try {
      await k8sCoreApi.readNamespacedSecret({ name, namespace })
      return true
    } catch (e: any) {
      if (e.response.statusCode === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async waitSecret(name: string, namespace: string, dataKeys: string[] = [], timeout = AWAIT_TIMEOUT_S): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Set up watcher
      const watcher = new Watch(this.kubeConfig)
      const request = await watcher
      .watch(`/api/v1/namespaces/${namespace}/secrets/`, { fieldSelector: `metadata.name=${name}` }, (_phase: string, obj: any) => {
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
      }, timeout * 1000)

      // Request secret, for case if it is already exist
      const secret = await this.getSecret(name, namespace)
      if (secret) {
        // Stop watching
        request.abort()
        clearTimeout(timeoutHandler)

        // Release awaiter
        resolve()
      }
    })
  }

  async listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      return await k8sApi.listNamespacedPod({ namespace, fieldSelector, labelSelector })
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
}
