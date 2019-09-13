/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { Core_v1Api, KubeConfig } from '@kubernetes/client-node'
import axios from 'axios'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as yaml from 'js-yaml'

import { OpenShiftHelper } from '../api/openshift'

import { Devfile } from './devfile'
import { KubeHelper } from './kube'

export class CheHelper {
  defaultCheResponseTimeoutMs = 3000
  kc = new KubeConfig()
  kube: KubeHelper
  oc = new OpenShiftHelper()

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
  }

  async cheServerPodExist(namespace: string): Promise<boolean> {
    const kc = new KubeConfig()
    kc.loadFromDefault()

    const k8sApi = kc.makeApiClient(Core_v1Api)
    let found = false

    await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, 'app=che')
      .then(res => {
        if (res.body.items.length > 0) {
          found = true
        } else {
          found = false
        }
      }).catch(err => { throw err })
    return found
  }

  /**
   * Finds a pod where Che workspace is running.
   * Rejects if no workspace is found for the given workspace ID
   * or if workspace ID wasn't specified but more than one workspace is found.
   */
  async getWorkspacePod(namespace: string, cheWorkspaceId?: string): Promise<string> {
    this.kc.loadFromDefault()
    const k8sApi = this.kc.makeApiClient(Core_v1Api)

    const res = await k8sApi.listNamespacedPod(namespace)
    const pods = res.body.items
    const wsPods = pods.filter(pod => pod.metadata.labels['che.workspace_id'])
    if (wsPods.length === 0) {
      throw new Error('No workspace pod is found')
    }

    if (cheWorkspaceId) {
      const wsPod = wsPods.find(p => p.metadata.labels['che.workspace_id'] === cheWorkspaceId)
      if (wsPod) {
        return wsPod.metadata.name
      }
      throw new Error('Pod is not found for the given workspace ID')
    } else {
      if (wsPods.length === 1) {
        return wsPods[0].metadata.name
      }
      throw new Error('More than one pod with running workspace is found. Please, specify Che Workspace ID.')
    }
  }

  async getWorkspacePodContainers(namespace: string, cheWorkspaceId?: string): Promise<string[]> {
    this.kc.loadFromDefault()
    const k8sApi = this.kc.makeApiClient(Core_v1Api)

    const res = await k8sApi.listNamespacedPod(namespace)
    const pods = res.body.items
    const wsPods = pods.filter(pod => pod.metadata.labels['che.workspace_id'])
    if (wsPods.length === 0) {
      throw new Error('No workspace pod is found')
    }

    if (cheWorkspaceId) {
      const wsPod = wsPods.find(p => p.metadata.labels['che.workspace_id'] === cheWorkspaceId)
      if (wsPod) {
        return wsPod.spec.containers.map(c => c.name)
      }
      throw new Error('Pod is not found for the given workspace ID')
    } else {
      if (wsPods.length === 1) {
        return wsPods[0].spec.containers.map(c => c.name)
      }
      throw new Error('More than one pod with running workspace is found. Please, specify Che Workspace ID.')
    }
  }

  async cheURL(namespace = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error(`ERR_NAMESPACE_NO_EXIST - No namespace ${namespace} is found`)
    }

    if (await this.kube.isOpenShift()) {
      return this.cheOpenShiftURL(namespace)
    } else {
      return this.cheK8sURL(namespace)
    }
  }

  async cheK8sURL(namespace = ''): Promise<string> {
    const ingress_names = ['che', 'che-ingress']
    for (const ingress_name of ingress_names) {
      if (await this.kube.ingressExist(ingress_name, namespace)) {
        const protocol = await this.kube.getIngressProtocol(ingress_name, namespace)
        const hostname = await this.kube.getIngressHost(ingress_name, namespace)
        return `${protocol}://${hostname}`
      }
    }
    throw new Error(`ERR_INGRESS_NO_EXIST - No ingress ${ingress_names} in namespace ${namespace}`)
  }

  async cheOpenShiftURL(namespace = ''): Promise<string> {
    const route_names = ['che', 'che-host']
    for (const route_name of route_names) {
      if (await this.oc.routeExist(route_name, namespace)) {
        const protocol = await this.oc.getRouteProtocol(route_name, namespace)
        const hostname = await this.oc.getRouteHost(route_name, namespace)
        return `${protocol}://${hostname}`
      }
    }
    throw new Error(`ERR_ROUTE_NO_EXIST - No route ${route_names} in namespace ${namespace}`)
  }

  async cheNamespaceExist(namespace = '') {
    this.kc.loadFromDefault()
    const k8sApi = this.kc.makeApiClient(Core_v1Api)
    try {
      const res = await k8sApi.readNamespace(namespace)
      if (res && res.body &&
        res.body.metadata && res.body.metadata.name
        && res.body.metadata.name === namespace) {
        return true
      } else {
        return false
      }
    } catch {
      return false
    }
  }

  async getCheServerStatus(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<string> {
    const endpoint = `${cheURL}/api/system/state`
    let response = null
    try {
      response = await axios.get(endpoint, { timeout: responseTimeoutMs })
    } catch (error) {
      throw this.getCheApiError(error, endpoint)
    }
    if (!response || response.status !== 200 || !response.data || !response.data.status) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
    return response.data.status
  }

  async startShutdown(cheURL: string, accessToken = '', responseTimeoutMs = this.defaultCheResponseTimeoutMs) {
    const endpoint = `${cheURL}/api/system/stop?shutdown=true`
    const headers = accessToken ? { Authorization: `${accessToken}` } : null
    let response = null
    try {
      response = await axios.post(endpoint, null, { headers, timeout: responseTimeoutMs })
    } catch (error) {
      if (error.response && error.response.status === 409) {
        return
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }
    if (!response || response.status !== 204) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
  }

  async waitUntilReadyToShutdown(cheURL: string, intervalMs = 500, timeoutMs = 60000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let status = await this.getCheServerStatus(cheURL)
      if (status === 'READY_TO_SHUTDOWN') {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error('ERR_TIMEOUT')
  }

  async isCheServerReady(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const id = await axios.interceptors.response.use(response => response, async (error: any) => {
      if (error.config && error.response && (error.response.status === 404 || error.response.status === 503)) {
        return axios.request(error.config)
      }
      return Promise.reject(error)
    })

    try {
      await axios.get(`${cheURL}/api/system/state`, { timeout: responseTimeoutMs })
      await axios.interceptors.response.eject(id)
      return true
    } catch {
      await axios.interceptors.response.eject(id)
      return false
    }
  }

  async createWorkspaceFromDevfile(namespace: string | undefined, devfilePath = '', workspaceName: string | undefined, accessToken = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error('E_BAD_NS')
    }
    let url = await this.cheURL(namespace)
    let endpoint = `${url}/api/workspace/devfile`
    let devfile
    let response
    const headers: any = { 'Content-Type': 'text/yaml' }
    if (accessToken && accessToken.length > 0) {
      headers.Authorization = `${accessToken}`
    }

    try {
      devfile = await this.parseDevfile(devfilePath)
      if (workspaceName) {
        let json: Devfile = yaml.load(devfile)
        json.metadata.name = workspaceName
        devfile = yaml.dump(json)
      }
      response = await axios.post(endpoint, devfile, { headers })
    } catch (error) {
      if (!devfile) { throw new Error(`E_NOT_FOUND_DEVFILE - ${devfilePath} - ${error.message}`) }
      if (error.response && error.response.status === 400) {
        throw new Error(`E_BAD_DEVFILE_FORMAT - Message: ${error.response.data.message}`)
      }
      throw this.getCheApiError(error, endpoint)
    }
    if (response && response.data && response.data.links && response.data.links.ide) {
      let ideURL = response.data.links.ide
      return this.buildDashboardURL(ideURL)
    } else {
      throw new Error('E_BAD_RESP_CHE_SERVER')
    }
  }

  async parseDevfile(devfilePath = ''): Promise<string> {
    if (devfilePath.startsWith('http')) {
      const response = await axios.get(devfilePath)
      return response.data
    } else {
      return fs.readFileSync(devfilePath, 'utf8')
    }
  }

  async createWorkspaceFromWorkspaceConfig(namespace: string | undefined, workspaceConfigPath = '', accessToken = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error('E_BAD_NS')
    }
    let url = await this.cheURL(namespace)
    let endpoint = `${url}/api/workspace`
    let workspaceConfig
    let response
    const headers: any = { 'Content-Type': 'application/json' }
    if (accessToken && accessToken.length > 0) {
      headers.Authorization = `${accessToken}`
    }

    try {
      let workspaceConfig = fs.readFileSync(workspaceConfigPath, 'utf8')
      response = await axios.post(endpoint, workspaceConfig, { headers })
    } catch (error) {
      if (!workspaceConfig) { throw new Error(`E_NOT_FOUND_WORKSPACE_CONFIG_FILE - ${workspaceConfigPath} - ${error.message}`) }
      if (error.response && error.response.status === 400) {
        throw new Error(`E_BAD_WORKSPACE_CONFIG_FORMAT - Message: ${error.response.data.message}`)
      }
      throw this.getCheApiError(error, endpoint)
    }
    if (response && response.data && response.data.links && response.data.links.ide) {
      let ideURL = response.data.links.ide
      return this.buildDashboardURL(ideURL)
    } else {
      throw new Error('E_BAD_RESP_CHE_SERVER')
    }
  }

  async isAuthenticationEnabled(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const endpoint = `${cheURL}/api/keycloak/settings`
    let response = null
    try {
      response = await axios.get(endpoint, { timeout: responseTimeoutMs })
    } catch (error) {
      if (error.response && (error.response.status === 404 || error.response.status === 503)) {
        return false
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }
    if (!response || response.status !== 200 || !response.data) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
    return true
  }

  async buildDashboardURL(ideURL: string): Promise<string> {
    return ideURL.replace(/\/[^/|.]*\/[^/|.]*$/g, '\/dashboard\/#\/ide$&')
  }

  private getCheApiError(error: any, endpoint: string): Error {
    if (error.response && error.response.status === 403) {
      return new Error(`E_CHE_API_FORBIDDEN - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data.message)}`)
    }
    if (error.response && error.response.status === 401) {
      return new Error(`E_CHE_API_UNAUTHORIZED - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data)}`)
    }
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      return new Error(`E_CHE_API_UNKNOWN_ERROR - Endpoint: ${endpoint} -Status: ${error.response.status}`)
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      return new Error(`E_CHE_API_NO_RESPONSE - Endpoint: ${endpoint} - Error message: ${error.message}`)
    } else {
      // Something happened in setting up the request that triggered an Error
      return new Error(`E_CHECTL_UNKNOWN_ERROR - Endpoint: ${endpoint} - Message: ${error.message}`)
    }
  }
}
