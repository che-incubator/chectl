// tslint:disable:object-curly-spacing
// tslint:disable-next-line:no-http-string

import { Core_v1Api, KubeConfig } from '@kubernetes/client-node'
import axios from 'axios'
import * as execa from 'execa'
import * as fs from 'fs'

export class CheHelper {
  // async chePodExist(namespace: string): Promise<boolean> {
  //   const kc = new KubeConfig()
  //   kc.loadFromDefault()

  //   const k8sApi = kc.makeApiClient(Core_v1Api)

  //   await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, 'app=che')
  //     .then(res => {
  //       res.body.items.forEach(pod => {
  //         console.log(`Pod name: ${pod.metadata.name}`)
  //         return true
  //       })
  //       // (pod => {
  //       //   console.log(`Pod: ${pod.metadata.namespace}/${pod.metadata.name}`)
  //       // })
  //     }).catch(err => console.error(`Error: ${err.message}`))
  //   return false
  // }

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
    const wsPods = pods.filter(pod => pod.metadata.labels['che.workspace_id'] !== undefined)
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

  async cheURL(namespace: string | undefined = ''): Promise<string> {
    const protocol = 'http'
    const { stdout } = await execa('kubectl',
      ['get',
        'ingress',
        '-n',
        `${namespace}`,
        '-o',
        'jsonpath={.spec.rules[0].host}',
        'che-ingress'
      ], { timeout: 10000 })
    const hostname = stdout.trim()
    return `${protocol}://${hostname}`
  }

  async cheNamespaceExist(namespace: string | undefined = '') {
    this.kc.loadFromDefault()
    const k8sApi = this.kc.makeApiClient(Core_v1Api)
    try {
      let res = await k8sApi.readNamespace(namespace)
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

  async isCheServerReady(namespace: string | undefined, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
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
      let url = await this.cheURL(namespace)
      await axios.get(`${url}/api/system/state`, { timeout: responseTimeoutMs })
      return true
    } catch {
      return false
    }
  }

  async createWorkspaceFromDevfile(namespace: string | undefined, devfilePath: string | undefined = ''): Promise<string> {
    if (!await this.cheNamespaceExist(namespace)) {
      throw new Error('E_BAD_NS')
    }

    let devfile
    let url = await this.cheURL(namespace)

    try {
      devfile = fs.readFileSync(devfilePath, 'utf8')
      let response = await axios.post(`${url}/api/devfile`, devfile, {headers: {'Content-Type': 'text/yaml'}})
      if (response && response.data && response.data.links && response.data.links.ide) {
        // console.log(response.data)
        // console.log(response.status)
        // console.log(response.statusText)
        // console.log(response.headers)
        // console.log(response.config)
        let ideURL = response.data.links.ide
        return ideURL.replace(/\/\w*\/\w*$/g, '\/dashboard\/#\/ide$&')
      } else {
        throw new Error('E_BAD_RESP_CHE_SERVER')
      }
    } catch (error) {
      if (!devfile) { throw new Error(`E_NOT_FOUND_DEFILE - ${devfilePath} - ${error.message}`) }
      if (error.response && error.response.status && error.response.status === 400) {
        // console.log(error.response.data)
        // console.log(error.response.status)
        // console.log(error.response.headers)
        throw new Error(`E_BAD_DEFILE_FORMAT - Message: ${error.response.data.message}`)
      }

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        // console.log(error.response.data)
        // console.log(error.response.status)
        // console.log(error.response.headers)
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
}
