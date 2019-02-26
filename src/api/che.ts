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
// tslint:disable-next-line:no-http-string

import { Core_v1Api, KubeConfig } from '@kubernetes/client-node'
import axios from 'axios'
import * as execa from 'execa'
import * as fs from 'fs'

import { KubeHelper } from '../api/kube'

export class CheHelper {
  defaultCheResponseTimeoutMs = 3000
  kc = new KubeConfig()

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

  async cheURLByIngress(ingress: string, namespace = ''): Promise<string> {
    const protocol = 'http'
    const { stdout } = await execa('kubectl',
      ['get',
        'ingress',
        '-n',
        `${namespace}`,
        '-o',
        'jsonpath={.spec.rules[0].host}',
        ingress
      ], { timeout: 10000 })
    const hostname = stdout.trim()
    return `${protocol}://${hostname}`
  }

  async cheURL(namespace = ''): Promise<string> {
    const kube = new KubeHelper()
    const protocol = 'http'
    let hostname = ''
    if (await kube.ingressExist('che', namespace)) {
      hostname = await kube.getIngressHost('che', namespace)
    } else if (await kube.ingressExist('che-ingress', namespace)) {
      hostname = await kube.getIngressHost('che-ingress', namespace)
    } else {
      throw new Error('ERR_INGRESS_NO_EXIST')
    }
    return `${protocol}://${hostname}`
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

  async isCheServerReady(cheURL: string, namespace = '', responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    if (!await this.cheNamespaceExist(namespace)) {
      return false
    }

    await axios.interceptors.response.use(response => response, async (error: any) => {
      if (error.config && error.response && (error.response.status === 404 || error.response.status === 503)) {
        return axios.request(error.config)
      }
      return Promise.reject(error)
    })

    try {
      await axios.get(`${cheURL}/api/system/state`, { timeout: responseTimeoutMs })
      return true
    } catch {
      return false
    }
  }

  async createWorkspaceFromDevfile(namespace: string | undefined, devfilePath = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error('E_BAD_NS')
    }

    let devfile

    try {
      let url = await this.cheURL(namespace)
      devfile = fs.readFileSync(devfilePath, 'utf8')
      let response = await axios.post(`${url}/api/devfile`, devfile, {headers: {'Content-Type': 'text/yaml'}})
      if (response && response.data && response.data.links && response.data.links.ide) {
        let ideURL = response.data.links.ide
        return this.buildDashboardURL(ideURL)
      } else {
        throw new Error('E_BAD_RESP_CHE_SERVER')
      }
    } catch (error) {
      if (!devfile) { throw new Error(`E_NOT_FOUND_DEVFILE - ${devfilePath} - ${error.message}`) }
      if (error.response && error.response.status === 400) {
        throw new Error(`E_BAD_DEVFILE_FORMAT - Message: ${error.response.data.message}`)
      }
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`E_CHE_SERVER_UNKNOWN_ERROR - Status: ${error.response.status}`)
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        throw new Error(`E_CHE_SERVER_NO_RESPONSE - ${error.message}`)
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`E_CHECTL_UNKNOWN_ERROR - Message: ${error.message}`)
      }
    }
  }

  async createWorkspaceFromWorkspaceConfig(namespace: string | undefined, workspaceConfigPath = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error('E_BAD_NS')
    }

    let workspaceConfig
    try {
      let url = await this.cheURL(namespace)
      let workspaceConfig = fs.readFileSync(workspaceConfigPath, 'utf8')
      let response = await axios.post(`${url}/api/workspace`, workspaceConfig, {headers: {'Content-Type': 'application/json'}})
      if (response && response.data && response.data.links && response.data.links.ide) {
        let ideURL = response.data.links.ide
        return this.buildDashboardURL(ideURL)
      } else {
        throw new Error('E_BAD_RESP_CHE_SERVER')
      }
    } catch (error) {
      if (!workspaceConfig) { throw new Error(`E_NOT_FOUND_WORKSPACE_CONFIG_FILE - ${workspaceConfigPath} - ${error.message}`) }
      if (error.response && error.response.status === 400) {
        throw new Error(`E_BAD_WORKSPACE_CONFIG_FORMAT - Message: ${error.response.data.message}`)
      }
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        throw new Error(`E_CHE_SERVER_UNKNOWN_ERROR - Status: ${error.response.status}`)
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        throw new Error(`E_CHE_SERVER_NO_RESPONSE - ${error.message}`)
      } else {
        // Something happened in setting up the request that triggered an Error
        throw new Error(`E_CHECTL_UNKNOWN_ERROR - Message: ${error.message}`)
      }
    }
  }

  async buildDashboardURL(ideURL: string): Promise<string> {
    return ideURL.replace(/\/[^/|.]*\/[^/|.]*$/g, '\/dashboard\/#\/ide$&')
  }
}
