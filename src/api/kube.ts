/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import { Apps_v1Api, Core_v1Api, Extensions_v1beta1Api, KubeConfig, RbacAuthorization_v1Api, V1ConfigMap, V1ConfigMapEnvSource, V1Container, V1DeleteOptions, V1Deployment, V1DeploymentSpec, V1EnvFromSource, V1LabelSelector, V1ObjectMeta, V1Pod, V1PodSpec, V1PodTemplateSpec, V1RoleBinding, V1RoleRef, V1ServiceAccount, V1Subject } from '@kubernetes/client-node'
import { cli } from 'cli-ux'
import { readFileSync } from 'fs'
import * as yaml from 'js-yaml'

export class KubeHelper {
  kc = new KubeConfig()

  constructor(context?: string) {
    if (!context) {
      this.kc.loadFromDefault()
    } else {
      this.kc.loadFromString(context)
    }
  }

  async serviceAccountExist(name: string | undefined = '', namespace: string | undefined = ''): Promise<boolean | ''> {
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

  async createServiceAccount(name: string | undefined = '', namespace: string | undefined = '') {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let sa = new V1ServiceAccount()
    sa.metadata = new V1ObjectMeta()
    sa.metadata.name = name
    sa.metadata.namespace = namespace
    try {
      const response = await k8sCoreApi.createNamespacedServiceAccount(namespace, sa)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
  }

  async roleBindingExist(name: string | undefined = '', namespace: string | undefined = ''): Promise<boolean | ''> {
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

  async createAdminRoleBinding(name: string | undefined = '', serviceAccount: string | undefined = '', namespace: string | undefined = '') {
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
      const response = await k8sRbacAuthApi.createNamespacedRoleBinding(namespace, rb)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
  }

  async configMapExist(name: string | undefined = '', namespace: string | undefined = ''): Promise<boolean | ''> {
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

  async createConfigMapFromFile(filePath: string, namespace: string | undefined = '') {
    const yamlFile = readFileSync(filePath)
    const yamlConfigMap = yaml.safeLoad(yamlFile.toString()) as V1ConfigMap
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const response = await k8sCoreApi.createNamespacedConfigMap(namespace, yamlConfigMap)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
  }

  async patchConfigMap(name: string, patch: any, namespace: string | undefined = '') {
    const k8sCoreApi = this.kc.makeApiClient(PatchedK8sApi)
    try {
      const response = await k8sCoreApi.patchNamespacedConfigMap(name, namespace, patch)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
  }

  async podExist(name: string | undefined = '', namespace: string | undefined = ''): Promise<boolean | ''> {
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

  async podsExistBySelector(selector: string, namespace: string | undefined = ''): Promise<boolean> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
    } catch (e) {
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid reponse`)
    }

    return (res.body.items.length > 0)
  }

  async getPodPhase(selector: string, namespace: string | undefined = ''): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
    } catch (e) {
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid reponse`)
    }

    if (res.body.items.length !== 1) {
      throw new Error(`Get pods by selector "${selector}" returned ${res.body.items.length} pods (1 was expected)`)
    }

    if (!res.body.items[0].status || !res.body.items[0].status.phase) {
      throw new Error(`Get pods by selector "${selector}" returned a pod with an invalid state`)
    }

    return res.body.items[0].status.phase
  }

  async getPodReadyConditionStatus(selector: string, namespace: string | undefined = ''): Promise<string> {
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    let res
    try {
      res = await k8sCoreApi.listNamespacedPod(namespace, undefined, undefined, undefined, true, selector)
    } catch (e) {
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }

    if (!res || !res.body || !res.body.items) {
      throw new Error(`Get pods by selector "${selector}" returned an invalid reponse`)
    }

    if (res.body.items.length !== 1) {
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

  async waitForPodPhase(selector: string, targetPhase: string, namespace: string | undefined = '', intervalMs = 500, timeoutMs = 130000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let currentPhase = await this.getPodPhase(selector, namespace)
      if (targetPhase === currentPhase) {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error('ERR_TIMEOUT')
  }

  async waitForPodPending(selector: string, namespace: string | undefined = '', intervalMs = 500, timeoutMs = 130000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let podExist = await this.podsExistBySelector(selector, namespace)
      if (podExist) {
        let currentPhase = await this.getPodPhase(selector, namespace)
        if (currentPhase === 'Pending') {
          return
        } else {
          throw new Error(`ERR_UNEXPECTED_PHASE: ${currentPhase} (Pending expected) `)
        }
      }
      await cli.wait(intervalMs)
    }
    throw new Error('ERR_TIMEOUT')
  }

  async waitForPodReady(selector: string, namespace: string | undefined = '', intervalMs = 500, timeoutMs = 130000) {
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
    throw new Error('ERR_TIMEOUT')
  }

  async deletePod(name: string, namespace: string | undefined = '') {
    this.kc.loadFromDefault()
    const k8sCoreApi = this.kc.makeApiClient(Core_v1Api)
    const options = new V1DeleteOptions()
    try {
      const response = await k8sCoreApi.deleteNamespacedPod(name, namespace, options)
      return response
    } catch (e) {
      throw new Error(e.body.message)
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
      const response = await k8sAppsApi.createNamespacedDeployment(namespace, deployment)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
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
      const response = await k8sCoreApi.createNamespacedPod(namespace, pod)
      return response
    } catch (e) {
      throw new Error(e.body.message)
    }
  }

  async ingressExist(name: string | undefined = '', namespace: string | undefined = ''): Promise<boolean | ''> {
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

  async getIngressHost(name: string | undefined = '', namespace: string | undefined = ''): Promise<string> {
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
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }
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
