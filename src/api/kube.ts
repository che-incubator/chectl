/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Apiextensions_v1beta1Api, ApisApi, Apps_v1Api, Core_v1Api, Custom_objectsApi, Extensions_v1beta1Api, KubeConfig, RbacAuthorization_v1Api, V1beta1CustomResourceDefinition, V1beta1IngressList, V1ClusterRole, V1ClusterRoleBinding, V1ConfigMap, V1ConfigMapEnvSource, V1Container, V1DeleteOptions, V1Deployment, V1DeploymentList, V1DeploymentSpec, V1EnvFromSource, V1LabelSelector, V1ObjectMeta, V1PersistentVolumeClaimList, V1Pod, V1PodSpec, V1PodTemplateSpec, V1Role, V1RoleBinding, V1RoleRef, V1Secret, V1ServiceAccount, V1ServiceList, V1Subject } from '@kubernetes/client-node'
import axios from 'axios'
import { cli } from 'cli-ux'
import { readFileSync } from 'fs'
import https = require('https')
import * as yaml from 'js-yaml'
export class KubeHelper {
  kc = new KubeConfig()

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
    const k8sApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sApi.listNamespacedService(namespace, 'true')
      if (res && res.response && res.response.statusCode === 200) {
        const serviceList = res.body
        const options = new V1DeleteOptions()
        await serviceList.items.forEach(async service => {
          await k8sApi.deleteNamespacedService(service.metadata.name, namespace, options)
        })
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getServicesBySelector(labelSelector = '', namespace = ''): Promise<V1ServiceList> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sCoreApi.listNamespacedService(namespace, 'true', undefined, undefined, true, labelSelector)
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

  async serviceAccountExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sApi.readNamespacedServiceAccount(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async createServiceAccount(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
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
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedServiceAccount(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createServiceAccountFromFile(filePath: string, namespace = '') {
    const yamlFile = readFileSync(filePath)
    const yamlServiceAccount = yaml.safeLoad(yamlFile.toString()) as V1ServiceAccount
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      return await k8sCoreApi.createNamespacedServiceAccount(namespace, yamlServiceAccount)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async roleExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.readNamespacedRole(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async clusterRoleExist(name = ''): Promise<boolean | ''> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.readClusterRole(name)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async createRoleFromFile(filePath: string, namespace = '') {
    const yamlFile = readFileSync(filePath)
    const yamlRole = yaml.safeLoad(yamlFile.toString()) as V1Role
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.createNamespacedRole(namespace, yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        if (e.body && e.body.message) throw new Error(e.body.message)
        else throw new Error(e)
      }
    }
  }

  async createClusterRoleFromFile(filePath: string) {
    const yamlFile = readFileSync(filePath)
    const yamlRole = yaml.safeLoad(yamlFile.toString()) as V1ClusterRole
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.createClusterRole(yamlRole)
      return res.response.statusCode
    } catch (e) {
      if (e.response && e.response.statusCode && e.response.statusCode === 403) {
        return e.response.statusCode
      } else {
        if (e.body && e.body.message) throw new Error(e.body.message)
        else throw new Error(e)
      }
    }
  }

  async deleteRole(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedRole(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRole(name = '') {
    const k8sCoreApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteClusterRole(name, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async roleBindingExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.readNamespacedRoleBinding(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async clusterRoleBindingExist(name = ''): Promise<boolean | ''> {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const res = await k8sRbacAuthApi.readClusterRoleBinding(name)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async createAdminRoleBinding(name = '', serviceAccount = '', namespace = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
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
    const yamlFile = readFileSync(filePath)
    const yamlRoleBinding = yaml.safeLoad(yamlFile.toString()) as V1RoleBinding
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      return await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, yamlRoleBinding)
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
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      return await k8sRbacAuthApi.createClusterRoleBinding(clusterRoleBinding)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteRoleBinding(name = '', namespace = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const options = new V1DeleteOptions()
      return await k8sRbacAuthApi.deleteNamespacedRoleBinding(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteClusterRoleBinding(name = '') {
    const k8sRbacAuthApi = this.kc.makeApiClient(RbacAuthorization_v1Api)
    try {
      const options = new V1DeleteOptions()
      return await k8sRbacAuthApi.deleteClusterRoleBinding(name, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async configMapExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sCoreApi.readNamespacedConfigMap(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async createConfigMapFromFile(filePath: string, namespace = '') {
    const yamlFile = readFileSync(filePath)
    const yamlConfigMap = yaml.safeLoad(yamlFile.toString()) as V1ConfigMap
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
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
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedConfigMap(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async podExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sCoreApi.readNamespacedPod(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async podsExistBySelector(selector: string, namespace = ''): Promise<boolean> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid response`)
    }

    return (res.body.items.length > 0)
  }

  async getPodPhase(selector: string, namespace = ''): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
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
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
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
        if (currentPhase === 'Pending') {
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
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    const options = new V1DeleteOptions()
    try {
      return await k8sCoreApi.deleteNamespacedPod(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deploymentExist(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      return ((res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name) as boolean)
    } catch {
      return false
    }
  }

  async deploymentReady(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(Apps_v1Api)
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
    const k8sApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      if (res && res.body && res.body.spec && res.body.spec.replicas) {
        throw new Error(`Deployment '${name}' without replicas in spec is fetched`)
      }
      return res.body.spec.replicas === 0
    } catch {
      return false
    }
  }

  async isDeploymentPaused(name = '', namespace = ''): Promise<boolean> {
    const k8sApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      const res = await k8sApi.readNamespacedDeployment(name, namespace)
      if (!res || !res.body || !res.body.spec) {
        throw new Error('E_BAD_DEPLOY_RESPONSE')
      }
      return res.body.spec.paused
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
    const k8sAppsApi = this.kc.makeApiClient(Apps_v1Api)
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
    const yamlFile = readFileSync(filePath)
    const yamlDeployment = yaml.safeLoad(yamlFile.toString()) as V1Deployment
    if (containerImage) {
      yamlDeployment.spec.template.spec.containers[containerIndex].image = containerImage
    }
    const k8sAppsApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      return await k8sAppsApi.createNamespacedDeployment(namespace, yamlDeployment)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async deleteAllDeployments(namespace = '') {
    const k8sAppsApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      await k8sAppsApi.deleteCollectionNamespacedDeployment(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getDeploymentsBySelector(labelSelector = '', namespace = ''): Promise<V1DeploymentList> {
    const k8sAppsApi = this.kc.makeApiClient(Apps_v1Api)
    try {
      const res = await k8sAppsApi.listNamespacedDeployment(namespace, 'true', undefined, undefined, true, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_NAMESPACES')
  }

  async createPod(name: string,
                  image: string,
                  serviceAccount: string,
                  restartPolicy: string,
                  pullPolicy: string,
                  configMapEnvSource: string,
                  namespace: string) {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
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

  async ingressExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sExtensionsApi = this.kc.makeApiClient(Extensions_v1beta1Api)
    try {
      const res = await k8sExtensionsApi.readNamespacedIngress(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async deleteAllIngresses(namespace = '') {
    const k8sExtensionsApi = this.kc.makeApiClient(Extensions_v1beta1Api)
    try {
      await k8sExtensionsApi.deleteCollectionNamespacedIngress(namespace)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCrdFromFile(filePath: string) {
    const yamlFile = readFileSync(filePath)
    const yamlCrd = yaml.safeLoad(yamlFile.toString()) as V1beta1CustomResourceDefinition
    const k8sApiextensionsApi = this.kc.makeApiClient(Apiextensions_v1beta1Api)
    try {
      return await k8sApiextensionsApi.createCustomResourceDefinition(yamlCrd)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async crdExist(name = ''): Promise<boolean | ''> {
    const k8sApiextensionsApi = this.kc.makeApiClient(Apiextensions_v1beta1Api)
    try {
      const res = await k8sApiextensionsApi.readCustomResourceDefinition(name)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async deleteCrd(name = '') {
    const k8sApiextensionsApi = this.kc.makeApiClient(Apiextensions_v1beta1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sApiextensionsApi.deleteCustomResourceDefinition(name, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async createCheClusterFromFile(filePath: string, flags: any, useDefaultCR: boolean) {
    const yamlFile = readFileSync(filePath)
    let yamlCr = yaml.safeLoad(yamlFile.toString())
    const cheNamespace = flags.chenamespace
    if (useDefaultCR) {
      // If we don't use an explicitely provided CheCluster CR,
      // then let's modify the default example CR with values
      // derived from the other parameters
      const cheImage = flags.cheimage
      const imageAndTag = cheImage.split(':', 2)
      yamlCr.spec.server.cheImage = imageAndTag[0]
      yamlCr.spec.server.cheImageTag = imageAndTag.length === 2 ? imageAndTag[1] : 'latest'
      yamlCr.spec.auth.openShiftoAuth = flags['os-oauth']
      yamlCr.spec.server.tlsSupport = flags.tls
      if (flags.tls) {
        yamlCr.spec.k8s.tlsSecretName = 'che-tls'
      }
      yamlCr.spec.server.selfSignedCert = flags['self-signed-cert']
      yamlCr.spec.k8s.ingressDomain = flags.domain
      let pluginRegistryUrl = flags['plugin-registry-url']
      if (pluginRegistryUrl) {
        yamlCr.spec.server.pluginRegistryUrl = pluginRegistryUrl
        yamlCr.spec.server.externalPluginRegistry = true
      }
      let devfileRegistryUrl = flags['devfile-registry-url']
      if (devfileRegistryUrl) {
        yamlCr.spec.server.devfileRegistryUrl = devfileRegistryUrl
        yamlCr.spec.server.externalDevfileRegistry = true
      }
      const tagExp = /:[^:]*$/
      const newTag = `:${yamlCr.spec.server.cheImageTag}`
      yamlCr.spec.auth.identityProviderImage = yamlCr.spec.auth.identityProviderImage.replace(tagExp, newTag)
      yamlCr.spec.server.pluginRegistryImage = yamlCr.spec.server.pluginRegistryImage.replace(tagExp, newTag)
      yamlCr.spec.server.devfileRegistryImage = yamlCr.spec.server.devfileRegistryImage.replace(tagExp, newTag)
    }
    const customObjectsApi = this.kc.makeApiClient(Custom_objectsApi)
    try {
      return await customObjectsApi.createNamespacedCustomObject('org.eclipse.che', 'v1', cheNamespace, 'checlusters', yamlCr)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async cheClusterExist(name = '', namespace = ''): Promise<boolean | ''> {
    const customObjectsApi = this.kc.makeApiClient(Custom_objectsApi)
    try {
      const res = await customObjectsApi.getNamespacedCustomObject('org.eclipse.che', 'v1', namespace, 'checlusters', name)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async deleteCheCluster(name = '', namespace = '') {
    const customObjectsApi = this.kc.makeApiClient(Custom_objectsApi)
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

  /**
   * Retrieve the default token from the default serviceAccount.
   */
  async getDefaultServiceAccountToken(): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedServiceAccount('default')
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    if (!res || !res.body) {
      throw new Error('Unable to get default service account')
    }
    const v1ServiceAccountList = res.body
    let secretName
    if (v1ServiceAccountList.items && v1ServiceAccountList.items.length > 0) {
      for (let v1ServiceAccount of v1ServiceAccountList.items) {
        if (v1ServiceAccount.metadata.name === 'default') {
          secretName = v1ServiceAccount.secrets[0].name
        }
      }
    }
    if (!secretName) {
      throw new Error('Unable to get default service account secret')
    }

    // now get the matching secrets
    try {
      res = await k8sCoreApi.listNamespacedSecret('default')
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    if (!res || !res.body) {
      throw new Error('Unable to get default service account')
    }
    const v1SecretList = res.body
    let encodedToken
    if (v1SecretList.items && v1SecretList.items.length > 0) {
      for (let v1Secret of v1SecretList.items) {
        if (v1Secret.metadata.name === secretName && v1Secret.type === 'kubernetes.io/service-account-token') {
          encodedToken = v1Secret.data.token
        }
      }
    }
    if (!encodedToken) {
      throw new Error('Unable to grab default service account token')
    }
    // decode the token
    return Buffer.from(encodedToken, 'base64').toString()
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
    const k8sExtensionsApi = this.kc.makeApiClient(Extensions_v1beta1Api)
    try {
      const res = await k8sExtensionsApi.readNamespacedIngress(name, namespace)
      if (res && res.body &&
        res.body.spec &&
        res.body.spec.rules &&
        res.body.spec.rules.length > 0) {
        return res.body.spec.rules[0].host
      }
      throw new Error('ERR_INGRESS_NO_HOST')
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getIngressProtocol(name = '', namespace = ''): Promise<string> {
    const k8sExtensionsApi = this.kc.makeApiClient(Extensions_v1beta1Api)
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
    const k8sV1Beta = this.kc.makeApiClient(Extensions_v1beta1Api)
    try {
      const res = await k8sV1Beta.listNamespacedIngress(namespace, 'true', undefined, undefined, true, labelSelector)
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
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)

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

  async persistentVolumeClaimExist(name = '', namespace = ''): Promise<boolean | ''> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sCoreApi.readNamespacedPersistentVolumeClaim(name, namespace)
      return (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === name)
    } catch {
      return false
    }
  }

  async deletePersistentVolumeClaim(name = '', namespace = '') {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const options = new V1DeleteOptions()
      await k8sCoreApi.deleteNamespacedPersistentVolumeClaim(name, namespace, options)
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
  }

  async getPersistentVolumeClaimsBySelector(labelSelector = '', namespace = ''): Promise<V1PersistentVolumeClaimList> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sCoreApi.listNamespacedPersistentVolumeClaim(namespace, 'true', undefined, undefined, true, labelSelector)
      if (res && res.body) {
        return res.body
      }
    } catch (e) {
      throw this.wrapK8sClientError(e)
    }
    throw new Error('ERR_LIST_PVCS')
  }

  /**
   * Checks if message is present and returns error with it
   * or returns error with the specified error if message is not found.
   *
   * @param e k8s error to wrap
   */
  private wrapK8sClientError(e: any): Error {
    if (e.body && e.body.message) return new Error(e.body.message)
    else return new Error(e)
  }
}

class PatchedK8sApi extends Core_v1Api {
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

class PatchedK8sAppsApi extends Apps_v1Api {
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
