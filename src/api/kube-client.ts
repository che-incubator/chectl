/**
 * Copyright (c) 2019-2026 Red Hat, Inc.
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
  CoreV1Event,
  CoreV1EventList,
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
  V1CustomResourceDefinition,
  V1ValidatingWebhookConfiguration,
  V1MutatingWebhookConfiguration,
  PatchStrategy,
  setHeaderOptions,
} from '@kubernetes/client-node'
import {Cluster} from '@kubernetes/client-node/dist/config_types'
import axios, {AxiosRequestConfig} from 'axios'
import {ux} from '@oclif/core'
import execa = require('execa')
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
        throw new Error(`E_K8S_API_FORBIDDEN - Message: ${error.response.data.message}`, { cause: error })
      }

      if (error.response && error.response.status === 401) {
        throw new Error(`E_K8S_API_UNAUTHORIZED - Message: ${error.response.data.message}`, { cause: error })
      }

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`E_K8S_API_UNKNOWN_ERROR - Status: ${error.response.status}`, { cause: error })
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        throw new Error(`E_K8S_API_NO_RESPONSE - Endpoint: ${endpoint} - Error message: ${error.message}`, { cause: error })
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`E_CHECTL_UNKNOWN_ERROR - Message: ${error.message}`, { cause: error })
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
      res = await k8sCoreApi.listNamespacedSecret({namespace: namespaceName})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!res) {
      throw new Error('Unable to get default service account')
    }

    const v1SecretList = res

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
      await k8sCoreApi.createNamespace({body: namespace})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitNamespaceActive(name: string, timeoutMs = 60_000): Promise<void> {
    return this.startWatcher(
      '/api/v1/namespaces',
      `metadata.name=${name}`,
      (apiObj: any) => (apiObj as V1Namespace)?.status?.phase === 'Active',
      () => undefined,
      () => undefined,
      timeoutMs
    )
  }

  async deleteService(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.deleteNamespacedService({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getServicesBySelector(labelSelector: string, namespace: string): Promise<V1ServiceList> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService({namespace, labelSelector})
      return res
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isServiceAccountExist(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedServiceAccount({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deleteServiceAccount(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedServiceAccount({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createServiceAccount(serviceAccount: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete serviceAccount.metadata?.namespace
      await k8sCoreApi.createNamespacedServiceAccount({namespace, body: serviceAccount})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceServiceAccount(name: string, serviceAccount: V1ServiceAccount, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedServiceAccount({name, namespace})
      serviceAccount.metadata!.resourceVersion = (response as any).metadata.resourceVersion

      delete serviceAccount.metadata?.namespace
      await k8sCoreApi.replaceNamespacedServiceAccount({name, namespace, body: serviceAccount})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isRoleExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRole({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isClusterRoleExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRole({name})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createRole(role: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete role.metadata?.namespace
      await k8sRbacAuthApi.createNamespacedRole({namespace, body: role})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRole(role: V1Role, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete role.metadata?.namespace
      await k8sRbacAuthApi.replaceNamespacedRole({name: role.metadata!.name!, namespace, body: role})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRole(clusterRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRole({body: clusterRole})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRole(custerRole: V1ClusterRole): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRole({name: custerRole.metadata!.name!, body: custerRole})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRole(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteNamespacedRole({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getPodListByLabel(namespace: string, labelSelector: string): Promise<V1Pod[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const podList = await k8sCoreApi.listNamespacedPod({namespace, labelSelector})
      return podList.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sCoreApi.deleteClusterRole({name})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isRoleBindingExist(name: string, namespace: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readNamespacedRoleBinding({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async isValidatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readValidatingWebhookConfiguration({name})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceValidatingWebhookConfiguration(name: string, webhook: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const response = await k8sAdmissionApi.readValidatingWebhookConfiguration({name})
      webhook.metadata!.resourceVersion = (response as any).metadata.resourceVersion
      await k8sAdmissionApi.replaceValidatingWebhookConfiguration({name, body: webhook})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createValidatingWebhookConfiguration(webhook: V1ValidatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createValidatingWebhookConfiguration({body: webhook})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteValidatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteValidatingWebhookConfiguration({name})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isMutatingWebhookConfigurationExists(name: string): Promise<boolean> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.readMutatingWebhookConfiguration({name})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceVMutatingWebhookConfiguration(name: string, webhook: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      const response = await k8sAdmissionApi.readMutatingWebhookConfiguration({name})
      webhook.metadata!.resourceVersion = (response as any).metadata.resourceVersion
      await k8sAdmissionApi.replaceMutatingWebhookConfiguration({name, body: webhook})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createMutatingWebhookConfiguration(webhook: V1MutatingWebhookConfiguration): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.createMutatingWebhookConfiguration({body: webhook})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteMutatingWebhookConfiguration(name: string): Promise<void> {
    const k8sAdmissionApi = this.kubeConfig.makeApiClient(AdmissionregistrationV1Api)
    try {
      await k8sAdmissionApi.deleteMutatingWebhookConfiguration({name})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async isClusterRoleBindingExist(name: string): Promise<boolean> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.readClusterRoleBinding({name})
      return true
    } catch (e: any) {
      if (e.code === 404) {
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
      await k8sRbacAuthApi.createNamespacedRoleBinding({namespace, body: roleBinding})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBinding(roleBinding: V1RoleBinding, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      delete roleBinding.metadata?.namespace
      roleBinding.subjects![0].namespace = namespace
      await k8sRbacAuthApi.replaceNamespacedRoleBinding({
        name: roleBinding.metadata!.name!,
        namespace,
        body: roleBinding
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBinding(clusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.createClusterRoleBinding({body: clusterRoleBinding})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(clusterRoleBinding: V1ClusterRoleBinding): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.replaceClusterRoleBinding({
        name: clusterRoleBinding.metadata!.name!,
        body: clusterRoleBinding
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRoleBinding(name: string, namespace: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteNamespacedRoleBinding({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteClusterRoleBinding(name: string): Promise<void> {
    const k8sRbacAuthApi = this.kubeConfig.makeApiClient(RbacAuthorizationV1Api)
    try {
      await k8sRbacAuthApi.deleteClusterRoleBinding({name})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getConfigMap(name: string, namespace: string): Promise<V1ConfigMap | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedConfigMap({name, namespace})
      return response
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async listConfigMaps(namespace: string, labelSelector?: string): Promise<V1ConfigMap[]> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.listNamespacedConfigMap({namespace, labelSelector})
      return response.items
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getConfigMapValue(name: string, namespace: string, key: string): Promise<string | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedConfigMap({name, namespace})
      if (response.data) {
        return response.data[key]
      }
    } catch {
      return
    }
  }

  public async createConfigMap(configMap: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete configMap.metadata?.namespace
      await k8sCoreApi.createNamespacedConfigMap({namespace, body: configMap})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConfigMap(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedConfigMap({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteSecret(name: string, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespacedSecret({name, namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getNamespace(namespace: string): Promise<V1Namespace | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sApi.readNamespace({name: namespace})
      return response
    } catch {
    }
  }

  async patchNamespacedCustomObject(name: string, namespace: string, patch: any, resourceAPIGroup: string, resourceAPIVersion: string, resourcePlural: string): Promise<any | undefined> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const res = await k8sCoreApi.patchNamespacedCustomObject({
          group: resourceAPIGroup,
          version: resourceAPIVersion,
          namespace,
          plural: resourcePlural,
          name,
          body: patch
        },
        setHeaderOptions('Content-Type', PatchStrategy.MergePatch))
      if (res) {
        return res
      }
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getClusterCustomObject(group: string, version: string, plural: string, name: any): Promise<any> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await k8sCoreApi.getClusterCustomObject({group, version, plural, name})
      return response
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createClusterCustomObject(group: string, version: string, plural: string, body: any): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await k8sCoreApi.createClusterCustomObject({group, version, plural, body})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterCustomObject(group: string, version: string, plural: string, name: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await k8sCoreApi.deleteClusterCustomObject({group, version, plural, name})
      ux.debug(`Deleted ${plural}.${version}.${group} ${name} resource`)
    } catch (e: any) {
      if (e.code !== 404) {
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
      res = await k8sCoreApi.listNamespacedPod({namespace, labelSelector: selector})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.items) {
      return []
    }

    const conditions: V1PodCondition[] = []
    for (const pod of res.items) {
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
      res = await k8sCoreApi.listNamespacedPod({namespace, labelSelector: selector})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response.`)
    }

    if (res.items.length < 1) {
      // No pods found by the specified selector. So, it's not ready.
      return 'False'
    }

    if (!allowMultiple && res.items.length > 1) {
      // Several pods found, rolling update?
      return
    }

    if (!res.items[0].status || !res.items[0].status.conditions || !(res.items[0].status.conditions.length > 0)) {
      return
    }

    const conditions = res.items[0].status.conditions
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
      await k8sApi.readNamespacedDeployment({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async replaceConfigMap(name: string, configMap: V1ConfigMap, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedConfigMap({name, namespace})
      configMap.metadata!.resourceVersion = (response as any).metadata.resourceVersion

      delete configMap.metadata?.namespace
      await k8sCoreApi.replaceNamespacedConfigMap({name, namespace, body: configMap})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isConfigMapExists(name: string, namespace: string): Promise<boolean> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.readNamespacedConfigMap({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async scaleDeployment(name: string, namespace: string, replicas: number) {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    const patch = {
      spec: {
        replicas,
      },
    }
    let res
    try {
      res = await k8sAppsApi.patchNamespacedDeploymentScale(
        {name, namespace, body: patch},
        setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch))
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }

    if (!res) {
      throw new Error('Patch deployment scale returned an invalid response')
    }
  }

  async createDeployment(deployment: V1Deployment, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      delete deployment.metadata?.namespace
      await k8sAppsApi.createNamespacedDeployment({namespace, body: deployment})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceService(name: string, service: V1Service, namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const response = await k8sCoreApi.readNamespacedService({name, namespace})
      service.metadata!.resourceVersion = (response as any).metadata.resourceVersion

      delete service.metadata?.namespace
      await k8sCoreApi.replaceNamespacedService({name, namespace, body: service})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isServiceExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedService({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createService(service: V1Service, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      delete service.metadata?.namespace
      await k8sApi.createNamespacedService({namespace, body: service})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deletePod(name: string, namespace: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sApi.deleteNamespacedPod({name, namespace})
    } catch (e: any) {
      if (e.code === 404) {
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
      await k8sAppsApi.replaceNamespacedDeployment({name, namespace, body: deployment})
    } catch (e: any) {
      const wrappedError = this.wrapK8sClientError(e)
      if (!wrappedError.message.endsWith('field is immutable')) {
        throw wrappedError
      }

      try {
        await k8sAppsApi.deleteNamespacedDeployment({name, namespace})
        await k8sAppsApi.createNamespacedDeployment({namespace, body: deployment})
      } catch (e: any) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteDeployment(name: string, namespace: string): Promise<void> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteNamespacedDeployment({name, namespace})
    } catch (e: any) {
      if (e.code === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getDeployment(name: string, namespace: string): Promise<V1Deployment | undefined> {
    const k8sAppsApi = this.kubeConfig.makeApiClient(AppsV1Api)
    try {
      const res = await k8sAppsApi.readNamespacedDeployment({name, namespace})
      if (res) {
        return res!
      }
    } catch (error: any) {
      if (error.code === 404) {
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
      await networkingV1Api.createNamespacedIngress({namespace, body: ingress})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIngressExist(name: string, namespace: string): Promise<boolean> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      await networkingV1Api.readNamespacedIngress({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      return false
    }
  }

  async createCustomResourceDefinition(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.createCustomResourceDefinition({body: crd})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCustomResourceDefinition(crd: V1CustomResourceDefinition): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      if (!crd.metadata!.resourceVersion) {
        const response = await k8sApi.readCustomResourceDefinition({name: crd.metadata!.name!})
        crd.metadata!.resourceVersion = (response as any).metadata.resourceVersion
      }

      await k8sApi.replaceCustomResourceDefinition({name: crd.metadata!.name!, body: crd})
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getCustomResourceDefinition(name: string): Promise<any | undefined> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      const response = await k8sApi.readCustomResourceDefinition({name})
      return response
    } catch (e: any) {
      if (e.code === 404) {
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
        await customObjectsApi.deleteNamespacedCustomObject({
          group: apiGroup,
          version,
          namespace,
          plural,
          name,
          gracePeriodSeconds: 60
        })
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
        if (error.cause?.code === 404) {
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
        await k8sCoreApi.createNamespacedCustomObject({group, version, namespace, plural, body})
      } catch (e: any) {
        throw this.wrapK8sClientError(e)
      }
    } else {
      for (let i = 0; i < 30; i++) {
        try {
          await k8sCoreApi.createNamespacedCustomObject({group, version, namespace, plural, body})
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
          const response = await customObjectsApi.listClusterCustomObject({
            group: resourceAPIGroup,
            version: resourceAPIVersion,
            plural: resourcePlural
          })
          return (response as any).items ? (response as any).items : []
        } else {
          // If namespace is specified, list namespaced custom objects
          const response = await customObjectsApi.listNamespacedCustomObject({
            group: resourceAPIGroup,
            version: resourceAPIVersion,
            namespace,
            plural: resourcePlural
          })
          return (response as any).items ? (response as any).items : []
        }
      } catch (e: any) {
        if (e.code === 404) {
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
      await customObjectsApi.getNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'catalogsources',
        name
      })
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async getCatalogSource(name: string, namespace: string): Promise<CatalogSource | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'catalogsources',
        name
      })
      return response as CatalogSource
    } catch (e: any) {
      if (e.code === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createCatalogSource(catalogSource: CatalogSource, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      delete catalogSource.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'catalogsources',
        body: catalogSource
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitCatalogSource(name: string, namespace: string, timeoutMs = 60_000): Promise<CatalogSource> {
    const shouldStopFunc = (): boolean => {
      return true
    }

    const returnFunc = (apiObj: any): any => {
      return apiObj
    }

    return this.startWatcher(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/catalogsources`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      () => undefined,
      timeoutMs,
    )
  }

  async deleteCatalogSource(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'catalogsources',
        name
      })
    } catch (e: any) {
      if (e.code === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createOperatorSubscription(subscription: Subscription, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      delete subscription.metadata.namespace
      await customObjectsApi.createNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'subscriptions',
        body: subscription
      })
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
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'subscriptions',
        name
      })
      return response as Subscription
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async waitInstalledCSVInSubscription(name: string, namespace: string, timeoutMs = 60_000): Promise<string> {
    const shouldStopFunc = (apiObj: any): boolean => {
      const subscription = apiObj as Subscription
      return Boolean(subscription.status?.installedCSV)
    }

    const returnFunc = (apiObj: any): any => {
      const subscription = apiObj as Subscription
      return subscription.status?.installedCSV
    }

    return this.startWatcher(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      () => undefined,
      timeoutMs,
    )
  }

  async waitCSVStatusPhase(name: string, namespace: string, timeoutMs = 60_000): Promise<string> {
    const shouldStopFunc = (apiObj: any): boolean => {
      const csv = apiObj as ClusterServiceVersion
      return Boolean(csv.status?.phase)
    }

    const returnFunc = (apiObj: any): any => {
      const csv = apiObj as ClusterServiceVersion
      return csv.status?.phase
    }

    return this.startWatcher(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/clusterserviceversions`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      () => undefined,
      timeoutMs,
    )
  }

  async deleteOperatorSubscription(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'subscriptions',
        name
      })
    } catch (e: any) {
      if (e.code === 404) {
        return
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorSubscriptionReadyForApproval(name: string, namespace: string, timeoutMs = 120_000): Promise<InstallPlan> {
    const shouldStopFunc = (apiObj: any): boolean => {
      const subscription = apiObj as Subscription
      return Boolean(subscription.status?.installplan)
    }

    const returnFunc = (apiObj: any): any => {
      const subscription = apiObj as Subscription
      return subscription.status?.installplan
    }

    return this.startWatcher(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/subscriptions`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      () => undefined,
      timeoutMs,
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
      await customObjectsApi.patchNamespacedCustomObject({
          group: 'operators.coreos.com',
          version: 'v1alpha1',
          namespace,
          plural: 'installplans',
          name,
          body: patch
        },
        setHeaderOptions('Content-Type', PatchStrategy.MergePatch))
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async waitOperatorInstallPlan(name: string, namespace: string, timeoutMs = 180_000) {
    const shouldStopFunc = (apiObj: any): boolean => {
      const installPlan = apiObj as InstallPlan

      if (installPlan.status?.conditions) {
        for (const condition of installPlan.status.conditions) {
          if (condition.type === 'Installed' && condition.status === 'True') {
            return true
          }
        }
      }

      return false
    }

    const shouldErrorFunc = (apiObj: any): Error | undefined => {
      const installPlan = apiObj as InstallPlan

      if (installPlan.status?.phase === 'Failed') {
        const errorMessage = []
        for (const condition of installPlan.status.conditions) {
          if (condition.reason) {
            errorMessage.push(`Reason: ${condition.reason}`, condition.message ? `Message: ${condition.message}` : '')
          }
        }

        return new Error(errorMessage.join(' '))
      }

      return
    }

    const returnFunc = (apiObj: any): any => {
      const installPlan = apiObj as InstallPlan
      if (installPlan.status?.conditions) {
        for (const condition of installPlan.status.conditions) {
          if (condition.type === 'Installed' && condition.status === 'True') {
            return installPlan
          }
        }
      }
    }

    return this.startWatcher(
      `/apis/operators.coreos.com/v1alpha1/namespaces/${namespace}/installplans`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      shouldErrorFunc,
      timeoutMs,
    )
  }

  async getCSV(name: string, namespace: string): Promise<ClusterServiceVersion | undefined> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'clusterserviceversions',
        name
      })
      return response as ClusterServiceVersion
    } catch (e: any) {
      if (e.code !== 404) {
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

    try {
      const response = await customObjectsApi.patchNamespacedCustomObject({
          group: 'operators.coreos.com',
          version: 'v1alpha1',
          namespace,
          plural: 'clusterserviceversions',
          name,
          body: jsonPatch
        },
        setHeaderOptions('Content-Type', PatchStrategy.JsonPatch))
      return response as ClusterServiceVersion
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterServiceVersion(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'operators.coreos.com',
        version: 'v1alpha1',
        namespace,
        plural: 'clusterserviceversions',
        name
      })
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteCustomResourceDefinition(name: string): Promise<void> {
    const k8sApi = this.kubeConfig.makeApiClient(ApiextensionsV1Api)
    try {
      await k8sApi.deleteCustomResourceDefinition({name})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.deleteNamespace({name: namespace})
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteCertificate(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      // If cluster certificates doesn't exist an exception will be thrown
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'certificates',
        name
      })
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteIssuer(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'issuers',
        name
      })
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createCertificate(certificate: V1Certificate, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      delete certificate.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'certificates',
        body: certificate
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCertificate(name: string, certificate: V1Certificate, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'certificates',
        name
      })
      certificate.metadata.resourceVersion = (response as any).metadata.resourceVersion

      delete certificate.metadata?.namespace
      await customObjectsApi.replaceNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'certificates',
        name,
        body: certificate
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isCertificateExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'certificates',
        name
      })
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async createIssuer(issuer: any, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      delete issuer.metadata?.namespace
      await customObjectsApi.createNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'issuers',
        body: issuer
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceIssuer(name: string, issuer: any, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'issuers',
        name
      })
      issuer.metadata.resourceVersion = (response as any).metadata.resourceVersion

      delete issuer.metadata?.namespace
      await customObjectsApi.replaceNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'issuers',
        name,
        body: issuer
      })
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async isIssuerExists(name: string, namespace: string): Promise<boolean> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)
    try {
      await customObjectsApi.getNamespacedCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        namespace,
        plural: 'issuers',
        name
      })
      return true
    } catch (e: any) {
      if (e.code === 404) {
        return false
      }

      throw this.wrapK8sClientError(e)
    }
  }

  async deleteOperator(name: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteClusterCustomObject({
        group: 'operators.coreos.com',
        version: 'v1',
        plural: 'operators',
        name
      })
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteLease(name: string, namespace: string): Promise<void> {
    const customObjectsApi = this.kubeConfig.makeApiClient(CustomObjectsApi)

    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'coordination.k8s.io',
        version: 'v1',
        namespace,
        plural: 'leases',
        name
      })
    } catch (e: any) {
      if (e.code !== 404) {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async getIngressHost(name: string, namespace: string): Promise<string> {
    const networkingV1Api = this.kubeConfig.makeApiClient(NetworkingV1Api)
    try {
      const res = await networkingV1Api.readNamespacedIngress({name, namespace})
      if (res &&
        res.spec &&
        res.spec.rules &&
        res.spec.rules.length > 0) {
        return res.spec.rules[0].host || ''
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
      const res = await k8sCoreApi.readNamespacedSecret({name, namespace})
      return res ? res : undefined
    } catch {
      return
    }
  }

  async isSecretExists(name: string, namespace: string): Promise<boolean> {
    const k8sCoreApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      await k8sCoreApi.readNamespacedSecret({name, namespace})
      return true
    } catch (e: any) {
      if (e.code === 404) {
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
      return await k8sCoreApi.createNamespacedSecret({namespace, body: secret})
    } catch {
      return
    }
  }

  async startWatcher(
    path: string,
    fieldSelector: string,
    shouldStopFunc: (obj: any) => boolean,
    returnFunc: (obj: any) => any | undefined,
    shouldErrorFunc: (obj: any) => Error | undefined,
    timeoutMs: number): Promise<any> {
    let timeoutHandler: NodeJS.Timeout | undefined
    let abortRequest: (() => void) | undefined
    let settled = false

    // Guards against the watch callback, the error callback and the timeout racing
    // to settle, and against aborting a request that is not assigned yet.
    const settle = (action: () => void) => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandler) {
        clearTimeout(timeoutHandler)
      }

      abortRequest?.()
      action()
    }

    return new Promise(async (resolve, reject) => {
      try {
        const watcher = new Watch(this.kubeConfig)
        const request = await watcher.watch(path, {fieldSelector}, (type: string, apiObj: any) => {
            if (type !== 'ADDED' && type !== 'MODIFIED') {
              return
            }

            if (!shouldStopFunc(apiObj)) {
              return
            }

            const err = shouldStopFunc(apiObj)
            if (err) {
              reject(err)
            }

            settle(() => resolve(returnFunc(apiObj)))
          },
          error => {
            // Called with a null error when the stream closes normally, which happens
            // before the condition is met, so it must reject rather than leave the caller hanging.
            settle(() => reject(error ?? new Error(`Watch on '${path}' with '${fieldSelector}' closed before the condition was met.`)))
          })

        abortRequest = () => {
          try {
            request.abort()
          } catch {
            // Ignore abort errors
          }
        }

        if (settled) {
          abortRequest()
          return
        }

        timeoutHandler = setTimeout(() => {
          settle(() => reject(new Error(`Timeout reached while watching '${path}' with '${fieldSelector}'.`)))
        }, timeoutMs)
      } catch (error) {
        // An async executor's throw is swallowed by the Promise constructor,
        // which would otherwise leave the caller hanging forever.
        settle(() => reject(error))
      }
    })
  }

  async waitSecret(name: string, namespace: string, timeoutMs = 60_000): Promise<void> {
    const shouldStopFunc = (): boolean => {
      return true
    }

    const returnFunc = (): undefined => {
    }

    return this.startWatcher(
      `/api/v1/namespaces/${namespace}/secrets/`,
      `metadata.name=${name}`,
      shouldStopFunc,
      returnFunc,
      () => undefined,
      timeoutMs,
    )
  }

  async listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedPod({namespace, fieldSelector, labelSelector})
      return res ? res : {
        items: [],
      }
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listNamespacedEvent(namespace: string): Promise<CoreV1EventList> {
    const k8sApi = this.kubeConfig.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedEvent({namespace})
      return res ? res : {
        items: [],
      }
    } catch (e: any) {
      throw this.wrapK8sClientError(e)
    }
  }

  async watchNamespacedEvents(namespace: string, callback: (event: CoreV1Event) => void, onError?: (err: any) => void): Promise<void> {
    const watcher = new Watch(this.kubeConfig)
    await watcher.watch(`/api/v1/namespaces/${namespace}/events`, {}, (_phase: string, obj: CoreV1Event) => {
      callback(obj)
    }, err => {
      if (onError) {
        onError(err)
      }
    })
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

  private wrapK8sClientError(e: any): Error {
    if (e.body) {
      // New client returns body as a JSON string, old client returned an object
      let bodyObj = e.body
      if (typeof e.body === 'string') {
        try {
          bodyObj = JSON.parse(e.body)
        } catch {
          // If parsing fails, use the string as-is
          return newError(e.body, e)
        }
      }

      if (bodyObj.message) {
        return newError(bodyObj.message, e)
      }

      // If no message in body, try to stringify the body for the error message
      return newError(JSON.stringify(bodyObj), e)
    }

    // No body, return the error as-is
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
    return msg !== undefined && msg.includes('storage is (re)initializing')
  }

  private isTooManyRequestsError(error: any): boolean {
    const msg = error.message as string
    return msg !== undefined && (msg.includes('TooManyRequests') || (msg.includes('Too Many Requests')))
  }
}
