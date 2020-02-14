/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { ApiextensionsV1beta1Api, ApisApi, AppsV1Api, CoreV1Api, CustomObjectsApi, ExtensionsV1beta1Api, KubeConfig, Log, PortForward, RbacAuthorizationV1Api, V1beta1CustomResourceDefinition, V1beta1IngressList, V1ClusterRole, V1ClusterRoleBinding, V1ConfigMap, V1ConfigMapEnvSource, V1Container, V1DeleteOptions, V1Deployment, V1DeploymentList, V1DeploymentSpec, V1EnvFromSource, V1LabelSelector, V1NamespaceList, V1ObjectMeta, V1PersistentVolumeClaimList, V1Pod, V1PodList, V1PodSpec, V1PodTemplateSpec, V1Role, V1RoleBinding, V1RoleRef, V1Secret, V1ServiceAccount, V1ServiceList, V1Subject } from '@kubernetes/client-node'
import { Context } from '@kubernetes/client-node/dist/config_types'
import axios from 'axios'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import https = require('https')
import * as yaml from 'js-yaml'
import { merge } from 'lodash'
import * as net from 'net'
import { Writable } from 'stream'

import { DEFAULT_CHE_IMAGE } from '../constants'

export class KubeHelper {
  kc = new KubeConfig()
  portForwardHelper = new PortForward(this.kc, true)
  logHelper = new Log(this.kc)

  podWaitTimeout: number
  podReadyTimeout: number

  constructor(flags?: any, context?: string) {
    if (!context) {
      this.kc.loadFromDefault()
    } else {
      this.kc.loadFromString(context)
    }
    if (flags && flags.k8spodwaittimeout) {
      this.podWaitTimeout = parseInt(flags.k8spodwaittimeout, 10)
    } else {
      this.podWaitTimeout = 300000
    }
    if (flags && flags.k8spodreadytimeout) {
      this.podReadyTimeout = parseInt(flags.k8spodreadytimeout, 10)
    } else {
      this.podReadyTimeout = 130000
    }
  }

  async deleteAllServices(namespace = '') {
    const k8sApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedService(namespace, true)
      if (res && res.response && res.response.statusCode === 200) {
        const serviceList = res.body
        const options = new V1DeleteOptions()
        await serviceList.items.forEach(async service => {
          await k8sApi.deleteNamespacedService(service.metadata!.name!, namespace, undefined, options)
        })
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getServicesBySelector(labelSelector = '', namespace = ''): Promise<V1ServiceList> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService(namespace, true, 'true', undefined, undefined, labelSelector)
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
      let currentServices = await this.getServicesBySelector(selector, namespace)
      if (currentServices && currentServices.items.length > 0) {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to waiting for service ${timeoutMs}`)
  }

  async serviceAccountExist(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sApi.readNamespacedServiceAccount(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async createServiceAccount(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    let sa = new V1ServiceAccount()
    sa.metadata = new V1ObjectMeta()
    sa.metadata.name = name
    sa.metadata.namespace = namespace
    try {
      return await k8sCoreApi.createNamespacedServiceAccount(namespace, sa)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteServiceAccount(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedServiceAccount(name, namespace, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceAccountFromFile(filePath: string, namespace = '') {
    const yamlServiceAccount = this.safeLoadFromYamlFile(filePath) as V1ServiceAccount
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
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
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.replaceNamespacedServiceAccount(yamlServiceAccount.metadata.name, namespace, yamlServiceAccount)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async roleExist(name = '', namespace = ''): Promise<boolean> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readNamespacedRole(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async clusterRoleExist(name = ''): Promise<boolean> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readClusterRole(name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async createRoleFromFile(filePath: string, namespace = '') {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1Role
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.createNamespacedRole(namespace, yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async replaceRoleFromFile(filePath: string, namespace = '') {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1Role
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)

    if (!yamlRole.metadata || !yamlRole.metadata.name) {
      throw new Error(`Role read from ${filePath} must have name specified`)
    }
    try {
      const res = await k8sRbacAuthApi.replaceNamespacedRole(yamlRole.metadata.name, namespace, yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async createClusterRoleFromFile(filePath: string) {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1ClusterRole
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const res = await k8sRbacAuthApi.createClusterRole(yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async replaceClusterRoleFromFile(filePath: string) {
    const yamlRole = this.safeLoadFromYamlFile(filePath) as V1ClusterRole
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    if (!yamlRole.metadata || !yamlRole.metadata.name) {
      throw new Error(`Cluster Role read from ${filePath} must have name specified`)
    }
    try {
      const res = await k8sRbacAuthApi.replaceClusterRole(yamlRole.metadata.name, yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        throw this.wrapK8sClientError(e)
      }
    }
  }

  async deleteRole(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedRole(name, namespace, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name = '') {
    const k8sCoreApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteClusterRole(name, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async roleBindingExist(name = '', namespace = ''): Promise<boolean> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readNamespacedRoleBinding(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async clusterRoleBindingExist(name = ''): Promise<boolean | ''> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const { body } = await k8sRbacAuthApi.readClusterRoleBinding(name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async createAdminRoleBinding(name = '', serviceAccount = '', namespace = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    let rb = new V1RoleBinding()
    rb.metadata = new V1ObjectMeta()
    rb.metadata.name = name
    rb.metadata.namespace = namespace
    rb.roleRef = new V1RoleRef()
    rb.roleRef.kind = 'ClusterRole'
    rb.roleRef.name = 'admin'
    let subject = new V1Subject()
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

  async createRoleBindingFromFile(filePath: string, namespace = '') {
    const yamlRoleBinding = this.safeLoadFromYamlFile(filePath) as V1RoleBinding
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, yamlRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceRoleBindingFromFile(filePath: string, namespace = '') {
    const yamlRoleBinding = this.safeLoadFromYamlFile(filePath) as V1RoleBinding
    if (!yamlRoleBinding.metadata || !yamlRoleBinding.metadata.name) {
      throw new Error(`Role binding read from ${filePath} must have name specified`)
    }

    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.replaceNamespacedRoleBinding(yamlRoleBinding.metadata.name, namespace, yamlRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createClusterRoleBinding(name: string, saName: string, saNamespace = '', roleName = '') {
    const clusterRoleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      metadata: {
        name: `${name}`
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: `${saName}`,
          namespace: `${saNamespace}`
        }
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: `${roleName}`,
        apiGroup: 'rbac.authorization.k8s.io'
      }
    } as V1ClusterRoleBinding
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.createClusterRoleBinding(clusterRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceClusterRoleBinding(name: string, saName: string, saNamespace = '', roleName = '') {
    const clusterRoleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      metadata: {
        name: `${name}`
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: `${saName}`,
          namespace: `${saNamespace}`
        }
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: `${roleName}`,
        apiGroup: 'rbac.authorization.k8s.io'
      }
    } as V1ClusterRoleBinding
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      return await k8sRbacAuthApi.replaceClusterRoleBinding(name, clusterRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRoleBinding(name = '', namespace = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const options = new V1DeleteOptions()
      return await k8sRbacAuthApi.deleteNamespacedRoleBinding(name, namespace, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRoleBinding(name = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorizationV1Api)
    try {
      const options = new V1DeleteOptions()
      return await k8sRbacAuthApi.deleteClusterRoleBinding(name, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getConfigMap(name = '', namespace = ''): Promise<V1ConfigMap | undefined> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      return this.compare(body, name) && body
    } catch {
      return
    }
  }

  async createConfigMapFromFile(filePath: string, namespace = '') {
    const yamlConfigMap = this.safeLoadFromYamlFile(filePath) as V1ConfigMap
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      return await k8sCoreApi.createNamespacedConfigMap(namespace, yamlConfigMap)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async patchConfigMap(name: string, patch: any, namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(PatchedK8sApi)
    try {
      return await k8sCoreApi.patchNamespacedConfigMap(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteConfigMap(name: string, namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedConfigMap(name, namespace, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async readNamespacedPod(podName: string, namespace: string): Promise<V1Pod | undefined> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.readNamespacedPod(podName, namespace)
      if (res && res.body) {
        return res.body
      }
    } catch {
      return
    }
  }

  async podsExistBySelector(selector: string, namespace = ''): Promise<boolean> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, true, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response`)
    }

    return (res.body.items.length > 0)
  }

  async getPodPhase(selector: string, namespace = ''): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, true, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response`)
    }

    if (res.body.items.length !== 1) {
      throw new Error(`Get pods by selector "${selector}" returned ${res.body.items.length} pods (1 was expected)`)
    }

    if (!res.body.items[0].status || !res.body.items[0].status.phase) {
      throw new Error(`Get pods by selector "${selector}" returned a pod with an invalid state`)
    }

    return res.body.items[0].status.phase
  }

  async getPodReadyConditionStatus(selector: string, namespace = ''): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, true, undefined, undefined, undefined, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response`)
    }

    if (res.body.items.length < 1) {
      // No pods found by the specified selector. So, it's not ready.
      return 'False'
    }

    if (res.body.items.length > 1) {
      throw new Error(`Get pods by selector "${selector}" returned ${res.body.items.length} pods (1 was expected)`)
    }

    if (!res.body.items[0].status) {
      throw new Error(`Get pods by selector "${selector}" returned a pod with an invalid state`)
    }

    if (!res.body.items[0].status.conditions || !(res.body.items[0].status.conditions.length > 0)) {
      throw new Error(`Get pods by selector "${selector}" returned a pod with an invalid status.conditions`)
    }

    const conditions = res.body.items[0].status.conditions
    for (let condition of conditions) {
      if (condition.type === 'Ready') {
        return condition.status
      }
    }

    throw new Error(`Get pods by selector "${selector}" returned a pod without a status.condition of type "Ready"`)
  }

  async waitForPodPhase(selector: string, targetPhase: string, namespace = '', intervalMs = 500, timeoutMs = this.podWaitTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let currentPhase = await this.getPodPhase(selector, namespace)
      if (targetPhase === currentPhase) {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to pod wait timeout ${this.podWaitTimeout}`)
  }

  async waitForPodPending(selector: string, namespace = '', intervalMs = 500, timeoutMs = this.podWaitTimeout) {
    const iterations = timeoutMs / intervalMs
    let podExist
    let currentPhase
    for (let index = 0; index < iterations; index++) {
      podExist = await this.podsExistBySelector(selector, namespace)
      if (podExist) {
        currentPhase = await this.getPodPhase(selector, namespace)
        if (currentPhase === 'Pending' || currentPhase === 'Running') {
          return
        } else {
          throw new Error(`ERR_UNEXPECTED_PHASE: ${currentPhase} (Pending expected) `)
        }
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to pod wait timeout ${this.podWaitTimeout}. podExist: ${podExist}, currentPhase: ${currentPhase}`)
  }

  async waitForPodReady(selector: string, namespace = '', intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let readyStatus = await this.getPodReadyConditionStatus(selector, namespace)
      if (readyStatus === 'True') {
        return
      }
      if (readyStatus !== 'False') {
        throw new Error(`ERR_BAD_READY_STATUS: ${readyStatus} (True or False expected) `)
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to pod ready timeout ${this.podReadyTimeout}`)
  }

  async waitUntilPodIsDeleted(selector: string, namespace = '', intervalMs = 500, timeoutMs = this.podReadyTimeout) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let readyStatus = await this.getPodReadyConditionStatus(selector, namespace)
      if (readyStatus === 'False') {
        return
      }
      if (readyStatus !== 'True') {
        throw new Error(`ERR_BAD_READY_STATUS: ${readyStatus} (True or False expected) `)
      }
      await cli.wait(intervalMs)
    }
    throw new Error(`ERR_TIMEOUT: Timeout set to pod ready timeout ${this.podReadyTimeout}`)
  }

  async deletePod(name: string, namespace = '') {
    this.kc.loadFromDefault()
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    const options = new V1DeleteOptions()
    try {
      return await k8sCoreApi.deleteNamespacedPod(name, namespace, undefined, options)
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

  async deploymentExist(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(AppsV1Api)
    try {
      const { body } = await k8sApi.readNamespacedDeployment(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deploymentReady(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(AppsV1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      return ((res && res.body &&
        res.body.status && res.body.status.readyReplicas
        && res.body.status.readyReplicas > 0) as boolean)
    } catch {
      return false
    }
  }

  async deploymentStopped(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(AppsV1Api)
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
    const k8sApi = this.kc.makeApiClient(AppsV1Api)
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
    const k8sApi = this.kc.makeApiClient(PatchedK8sAppsApi)
    try {
      const patch = {
        spec: {
          paused: true
        }
      }
      await k8sApi.patchNamespacedDeployment(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async resumeDeployment(name = '', namespace = '') {
    const k8sApi = this.kc.makeApiClient(PatchedK8sAppsApi)
    try {
      const patch = {
        spec: {
          paused: false
        }
      }
      await k8sApi.patchNamespacedDeployment(name, namespace, patch)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async scaleDeployment(name = '', namespace = '', replicas: number) {
    const k8sAppsApi = this.kc.makeApiClient(PatchedK8sAppsApi)
    const patch = {
      spec: {
        replicas
      }
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
    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
    let deployment = new V1Deployment()
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
    let opContainer = new V1Container()
    opContainer.name = name
    opContainer.image = image
    opContainer.imagePullPolicy = pullPolicy
    let envFromSource = new V1EnvFromSource()
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

  async createDeploymentFromFile(filePath: string, namespace = '', containerImage = '', containerIndex = 0) {
    const yamlDeployment = this.safeLoadFromYamlFile(filePath) as V1Deployment
    if (containerImage) {
      yamlDeployment.spec!.template.spec!.containers[containerIndex].image = containerImage
    }
    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
    try {
      return await k8sAppsApi.createNamespacedDeployment(namespace, yamlDeployment)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceDeploymentFromFile(filePath: string, namespace = '', containerImage = '', containerIndex = 0) {
    const yamlDeployment = this.safeLoadFromYamlFile(filePath) as V1Deployment
    if (containerImage) {
      yamlDeployment.spec!.template.spec!.containers[containerIndex].image = containerImage
    }
    if (!yamlDeployment.metadata || !yamlDeployment.metadata.name) {
      throw new Error(`Deployment read from ${filePath} must have name specified`)
    }

    // updating restartedAt to make sure that rollout will be restarted
    let annotations = yamlDeployment.spec!.template!.metadata!.annotations
    if (!annotations) {
      annotations = {}
      yamlDeployment.spec!.template!.metadata!.annotations = annotations
    }
    annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString()

    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
    try {
      return await k8sAppsApi.replaceNamespacedDeployment(yamlDeployment.metadata.name, namespace, yamlDeployment)
    } catch (e) {
      if (e.response && e.response.body && e.response.body.message && e.response.body.message.toString().endsWith('field is immutable')) {
        try {
          await k8sAppsApi.deleteNamespacedDeployment(yamlDeployment.metadata.name, namespace)
          return await k8sAppsApi.createNamespacedDeployment(namespace, yamlDeployment)
        } catch (e) {
          throw this.wrapK8sClientError(e)
        }
      }
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteAllDeployments(namespace = '') {
    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
    try {
      await k8sAppsApi.deleteCollectionNamespacedDeployment(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getDeploymentsBySelector(labelSelector = '', namespace = ''): Promise<V1DeploymentList> {
    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
    try {
      const res = await k8sAppsApi.listNamespacedDeployment(namespace, true, 'true', undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_NAMESPACES')
  }

  async getDeployment(name: string, namespace: string): Promise<V1Deployment | undefined> {
    const k8sAppsApi = this.kc.makeApiClient(AppsV1Api)
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
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    let pod = new V1Pod()
    pod.metadata = new V1ObjectMeta()
    pod.metadata.name = name
    pod.metadata.labels = { app: name }
    pod.metadata.namespace = namespace
    pod.spec = new V1PodSpec()
    pod.spec.containers
    pod.spec.restartPolicy = restartPolicy
    pod.spec.serviceAccountName = serviceAccount
    let opContainer = new V1Container()
    opContainer.name = name
    opContainer.image = image
    opContainer.imagePullPolicy = pullPolicy
    let envFromSource = new V1EnvFromSource()
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

  async compare(body: any, name: string): Promise<boolean> {
    if (body && body.metadata && body.metadata.name && body.metadata.name === name) {
      return true
    } else {
      return false
    }
  }

  async ingressExist(name = '', namespace = ''): Promise<boolean> {
    const k8sExtensionsApi = this.kc.makeApiClient(ExtensionsV1beta1Api)
    try {
      const { body } = await k8sExtensionsApi.readNamespacedIngress(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deleteAllIngresses(namespace = '') {
    const k8sExtensionsApi = this.kc.makeApiClient(ExtensionsV1beta1Api)
    try {
      await k8sExtensionsApi.deleteCollectionNamespacedIngress(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCrdFromFile(filePath: string) {
    const yamlCrd = this.safeLoadFromYamlFile(filePath) as V1beta1CustomResourceDefinition
    const k8sApiextensionsApi = this.kc.makeApiClient(ApiextensionsV1beta1Api)
    try {
      return await k8sApiextensionsApi.createCustomResourceDefinition(yamlCrd)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async replaceCrdFromFile(filePath: string, resourceVersion: string) {
    const yamlCrd = this.safeLoadFromYamlFile(filePath) as V1beta1CustomResourceDefinition
    if (!yamlCrd.metadata || !yamlCrd.metadata.name) {
      throw new Error(`CRD read from ${filePath} must have name specified`)
    }
    yamlCrd.metadata.resourceVersion = resourceVersion
    const k8sApiextensionsApi = this.kc.makeApiClient(ApiextensionsV1beta1Api)
    try {
      return await k8sApiextensionsApi.replaceCustomResourceDefinition(yamlCrd.metadata.name, yamlCrd)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async crdExist(name = ''): Promise<boolean | ''> {
    const k8sApiextensionsApi = this.kc.makeApiClient(ApiextensionsV1beta1Api)
    try {
      const { body } = await k8sApiextensionsApi.readCustomResourceDefinition(name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async getCrd(name = ''): Promise<V1beta1CustomResourceDefinition> {
    const k8sApiextensionsApi = this.kc.makeApiClient(ApiextensionsV1beta1Api)
    try {
      const { body } = await k8sApiextensionsApi.readCustomResourceDefinition(name)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteCrd(name = '') {
    const k8sApiextensionsApi = this.kc.makeApiClient(ApiextensionsV1beta1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sApiextensionsApi.deleteCustomResourceDefinition(name, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCheClusterFromFile(filePath: string, flags: any, useDefaultCR: boolean) {
    let yamlCr = this.safeLoadFromYamlFile(filePath)
    yamlCr = this.overrideDefaultValues(yamlCr, flags['che-operator-cr-patch-yaml'])

    const cheNamespace = flags.chenamespace
    if (useDefaultCR) {
      // If we don't use an explicitly provided CheCluster CR,
      // then let's modify the default example CR with values
      // derived from the other parameters
      const cheImage = flags.cheimage
      const imageAndTag = cheImage.split(':', 2)
      yamlCr.spec.server.cheImage = imageAndTag[0]
      yamlCr.spec.server.cheImageTag = imageAndTag.length === 2 ? imageAndTag[1] : 'latest'
      yamlCr.spec.server.cheDebug = flags.debug ? flags.debug.toString() : 'false'

      yamlCr.spec.auth.openShiftoAuth = flags['os-oauth']
      yamlCr.spec.server.tlsSupport = flags.tls
      if (flags.tls) {
        yamlCr.spec.k8s.tlsSecretName = 'che-tls'
      }
      yamlCr.spec.server.selfSignedCert = flags['self-signed-cert']
      yamlCr.spec.k8s.ingressDomain = flags.domain
      const pluginRegistryUrl = flags['plugin-registry-url']
      if (pluginRegistryUrl) {
        yamlCr.spec.server.pluginRegistryUrl = pluginRegistryUrl
        yamlCr.spec.server.externalPluginRegistry = true
      }
      const devfileRegistryUrl = flags['devfile-registry-url']
      if (devfileRegistryUrl) {
        yamlCr.spec.server.devfileRegistryUrl = devfileRegistryUrl
        yamlCr.spec.server.externalDevfileRegistry = true
      }

      yamlCr.spec.storage.postgresPVCStorageClassName = flags['postgres-pvc-storage-class-name']
      yamlCr.spec.storage.workspacePVCStorageClassName = flags['workspace-pvc-storage-class-name']

      if (flags.cheimage === DEFAULT_CHE_IMAGE &&
        yamlCr.spec.server.cheImageTag !== 'nightly' &&
        yamlCr.spec.server.cheImageTag !== 'latest') {
        // We obviously are using a release version of chectl with the default `cheimage`
        // => We should use the operator defaults for docker images
        yamlCr.spec.server.cheImage = ''
        yamlCr.spec.server.cheImageTag = ''
        yamlCr.spec.server.pluginRegistryImage = ''
        yamlCr.spec.server.devfileRegistryImage = ''
        yamlCr.spec.auth.identityProviderImage = ''
      }
    }
    const customObjectsApi = this.kc.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.createNamespacedCustomObject('org.eclipse.che', 'v1', cheNamespace, 'checlusters', yamlCr)
      return body
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  overrideDefaultValues(yamlCr: any, filePath: string): any {
    if (filePath) {
      const patchCr = this.safeLoadFromYamlFile(filePath)
      return merge(yamlCr, patchCr)
    } else {
      return yamlCr
    }
  }

  async cheClusterExist(name = '', namespace = ''): Promise<boolean> {
    const customObjectsApi = this.kc.makeApiClient(CustomObjectsApi)
    try {
      const { body } = await customObjectsApi.getNamespacedCustomObject('org.eclipse.che', 'v1', namespace, 'checlusters', name)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deleteCheCluster(name = '', namespace = '') {
    const customObjectsApi = this.kc.makeApiClient(CustomObjectsApi)
    try {
      const options = new V1DeleteOptions()
      await customObjectsApi.deleteNamespacedCustomObject('org.eclipse.che', 'v1', namespace, 'checlusters', name, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async currentContext(): Promise<string> {
    return this.kc.getCurrentContext()
  }

  getContext(name: string): Context | null {
    return this.kc.getContextObject(name)
  }

  /**
   * Retrieve the default token from the default serviceAccount.
   */
  async getDefaultServiceAccountToken(): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
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

    let v1DefaultSATokenSecret = v1SecretList.items.find(secret => secret.metadata!.annotations
      && secret.metadata!.annotations['kubernetes.io/service-account.name'] === saName
      && secret.type === 'kubernetes.io/service-account-token')

    if (!v1DefaultSATokenSecret) {
      throw new Error(`Secret for '${saName}' service account is not found in namespace '${namespaceName}'`)
    }

    return Buffer.from(v1DefaultSATokenSecret.data!.token, 'base64').toString()
  }

  async checkKubeApi() {
    const currentCluster = this.kc.getCurrentCluster()
    if (!currentCluster) {
      throw new Error('Failed to get current Kubernetes cluster: returned null')
    }
    const token = await this.getDefaultServiceAccountToken()

    const agent = new https.Agent({
      rejectUnauthorized: false
    })
    let endpoint = ''
    try {
      endpoint = `${currentCluster.server}/healthz`
      let response = await axios.get(`${endpoint}`, { httpsAgent: agent, headers: { Authorization: 'bearer ' + token } })
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
    const k8sApiApi = this.kc.makeApiClient(ApisApi)
    let res
    try {
      res = await k8sApiApi.getAPIVersions()
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    if (!res || !res.body) {
      throw new Error('Get API versions returned an invalid response')
    }
    const v1APIGroupList = res.body
    for (const v1APIGroup of v1APIGroupList.groups) {
      if (v1APIGroup.name === 'apps.openshift.io') {
        return true
      }
    }
    return false
  }

  async getIngressHost(name = '', namespace = ''): Promise<string> {
    const k8sExtensionsApi = this.kc.makeApiClient(ExtensionsV1beta1Api)
    try {
      const res = await k8sExtensionsApi.readNamespacedIngress(name, namespace)
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

  async getIngressProtocol(name = '', namespace = ''): Promise<string> {
    const k8sExtensionsApi = this.kc.makeApiClient(ExtensionsV1beta1Api)
    try {
      const res = await k8sExtensionsApi.readNamespacedIngress(name, namespace)
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

  async getIngressesBySelector(labelSelector = '', namespace = ''): Promise<V1beta1IngressList> {
    const k8sV1Beta = this.kc.makeApiClient(ExtensionsV1beta1Api)
    try {
      const res = await k8sV1Beta.listNamespacedIngress(namespace, true, 'true', undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_INGRESSES')
  }

  async apiVersionExist(expectedVersion: string): Promise<boolean> {
    const k8sCoreApi = this.kc.makeApiClient(ApisApi)

    // if matching APi Version
    try {
      const res = await k8sCoreApi.getAPIVersions()
      if (res && res.body && res.body.groups) {
        return res.body.groups.some(version => version.name === expectedVersion)
      } else {
        return false
      }
    } catch {
      return false
    }
  }

  async getSecret(name = '', namespace = 'default'): Promise<V1Secret | undefined> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)

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

  async persistentVolumeClaimExist(name = '', namespace = ''): Promise<boolean> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const { body } = await k8sCoreApi.readNamespacedPersistentVolumeClaim(name, namespace)
      return this.compare(body, name)
    } catch {
      return false
    }
  }

  async deletePersistentVolumeClaim(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedPersistentVolumeClaim(name, namespace, undefined, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getPersistentVolumeClaimsBySelector(labelSelector = '', namespace = ''): Promise<V1PersistentVolumeClaimList> {
    const k8sCoreApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sCoreApi.listNamespacedPersistentVolumeClaim(namespace, true, 'true', undefined, undefined, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_PVCS')
  }

  async listNamespace(): Promise<V1NamespaceList> {
    const k8sApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespace()
      if (res && res.body) {
        return res.body
      } else {
        return {
          items: []
        }
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async listNamespacedPod(namespace: string, fieldSelector?: string, labelSelector?: string): Promise<V1PodList> {
    const k8sApi = this.kc.makeApiClient(CoreV1Api)
    try {
      const res = await k8sApi.listNamespacedPod(namespace, true, undefined, undefined, fieldSelector, labelSelector)
      if (res && res.body) {
        return res.body
      } else {
        return {
          items: []
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
    return new Promise((resolve, reject) => {
      const stream = new Writable()
      stream._write = function (chunk, encoding, done) {
        fs.appendFileSync(filename, chunk, { encoding })
        done()
      }

      this.logHelper.log(namespace, pod, container, stream, error => {
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
    try {
      const server = net.createServer(async socket => {
        await this.portForwardHelper.portForward(namespace, podName, [port], socket, null, socket)
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
    if (e.response && e.response.body && e.response.body.message) return new Error(e.response.body.message)
    else return new Error(e)
  }

  private safeLoadFromYamlFile(filePath: string): any {
    return yaml.safeLoad(fs.readFileSync(filePath).toString())
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
