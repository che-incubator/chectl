// tslint:disable:object-curly-spacing
// tslint:disable-next-line:no-http-string

import { Core_v1Api, KubeConfig } from '@kubernetes/client-node'
import axios from 'axios'
import * as execa from 'execa'

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
      }).catch(err => console.error(`Error: ${err.message}`))
    return found
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
    const kc = new KubeConfig()
    kc.loadFromDefault()

    const k8sApi = kc.makeApiClient(Core_v1Api)
    let found = false

    try {
      let res = await k8sApi.listNamespace(namespace)
      console.error(`AAAAAAAA: ${res}`)
      if (res.body.items.length > 0) { found = true }
    } catch (err) {
      console.error(`BBBBBBBB: ${err.message}`)
    }

    return found
  }

  async isCheServerReady(namespace: string | undefined, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    if (!await this.cheNamespaceExist(namespace)) {
      return false
    }

    let url = await this.cheURL(namespace)
    await axios.interceptors.response.use(response => response, (error: any) => {
      if (error.config && error.response && (error.response.status === 404 || error.response.status === 305)) {
        return axios.request(error.config)
      }
      return Promise.reject(error)
    })

    try {
      await axios.get(`${url}/api/system/state`, { timeout: responseTimeoutMs })
      return true
    } catch {
      return false
    }
  }
}
