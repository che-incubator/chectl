/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { che as chetypes } from '@eclipse-che/api'
import { CoreV1Api, V1Pod, Watch } from '@kubernetes/client-node'
import axios, { AxiosInstance } from 'axios'
import * as cp from 'child_process'
import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as https from 'https'
import * as yaml from 'js-yaml'
import * as os from 'os'
import * as path from 'path'

import { OpenShiftHelper } from '../api/openshift'
import { CHE_ROOT_CA_SECRET_NAME, DEFAULT_CA_CERT_FILE_NAME } from '../constants'
import { base64Decode } from '../util'

import { CheApiClient } from './che-api-client'
import { Devfile } from './devfile'
import { KubeHelper } from './kube'

export class CheHelper {
  defaultCheResponseTimeoutMs = 3000
  kube: KubeHelper
  oc = new OpenShiftHelper()

  private readonly axios: AxiosInstance

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)

    // Make axios ignore untrusted certificate error for self-signed certificate case.
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })

    this.axios = axios.create({
      httpsAgent
    })
  }

  /**
   * Finds a pod where workspace is running.
   * Rejects if no workspace is found for the given workspace ID
   * or if workspace ID wasn't specified but more than one workspace is found.
   */
  async getWorkspacePodName(namespace: string, cheWorkspaceId: string): Promise<string> {
    const k8sApi = KubeHelper.KUBE_CONFIG.makeApiClient(CoreV1Api)

    const res = await k8sApi.listNamespacedPod(namespace)
    const pods = res.body.items
    const wsPods = pods.filter(pod => pod.metadata!.labels!['che.workspace_id'] && pod.metadata!.labels!['che.original_name'] !== 'che-jwtproxy')
    if (wsPods.length === 0) {
      throw new Error('No workspace pod is found')
    }

    if (cheWorkspaceId) {
      const wsPod = wsPods.find(p => p.metadata!.labels!['che.workspace_id'] === cheWorkspaceId)
      if (wsPod) {
        return wsPod.metadata!.name!
      }
      throw new Error('Pod is not found for the given workspace ID')
    } else {
      if (wsPods.length === 1) {
        return wsPods[0].metadata!.name!
      }
      throw new Error('More than one pod with running workspace is found. Please, specify Workspace ID.')
    }
  }

  async getWorkspacePodContainers(namespace: string, cheWorkspaceId?: string): Promise<string[]> {
    const k8sApi = KubeHelper.KUBE_CONFIG.makeApiClient(CoreV1Api)

    const res = await k8sApi.listNamespacedPod(namespace)
    const pods = res.body.items
    const wsPods = pods.filter(pod => pod.metadata!.labels!['che.workspace_id'] && pod.metadata!.labels!['che.original_name'] !== 'che-jwtproxy')
    if (wsPods.length === 0) {
      throw new Error('No workspace pod is found')
    }

    if (cheWorkspaceId) {
      const wsPod = wsPods.find(p => p.metadata!.labels!['che.workspace_id'] === cheWorkspaceId)
      if (wsPod) {
        return wsPod.spec!.containers.map(c => c.name)
      }
      throw new Error('Pod is not found for the given workspace ID')
    } else {
      if (wsPods.length === 1) {
        return wsPods[0].spec!.containers.map(c => c.name)
      }
      throw new Error('More than one pod with running workspace is found. Please, specify Workspace ID.')
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

  async isSelfSignedCertificateSecretExist(namespace: string): Promise<boolean> {
    const selfSignedCertSecret = await this.kube.getSecret(CHE_ROOT_CA_SECRET_NAME, namespace)
    return !!selfSignedCertSecret
  }

  /**
   * Gets self-signed Che CA certificate from 'self-signed-certificate' secret.
   * If secret doesn't exist, undefined is returned.
   */
  async retrieveCheCaCert(cheNamespace: string): Promise<string | undefined> {
    const cheCaSecret = await this.kube.getSecret(CHE_ROOT_CA_SECRET_NAME, cheNamespace)
    if (!cheCaSecret) {
      return
    }

    if (cheCaSecret.data && cheCaSecret.data['ca.crt']) {
      return base64Decode(cheCaSecret.data['ca.crt'])
    }

    throw new Error(`Secret "${CHE_ROOT_CA_SECRET_NAME}" has invalid format: "ca.crt" key not found in data.`)
  }

  async saveCheCaCert(cheCaCert: string, destinaton?: string): Promise<string> {
    if (destinaton && fs.existsSync(destinaton)) {
      if (fs.lstatSync(destinaton).isDirectory()) {
        destinaton = path.join(destinaton, DEFAULT_CA_CERT_FILE_NAME)
      }
    } else {
      // Fallback to default location
      destinaton = path.join(os.homedir(), DEFAULT_CA_CERT_FILE_NAME)
    }

    fs.writeFileSync(destinaton, cheCaCert)
    return destinaton
  }

  /**
   * Retreives Keycloak admin user credentials.
   * Works only with installers which use Che CR (operator, olm).
   * Returns credentials as an array of two values: [login, password]
   * In case of an error an array with undefined values will be returned.
   */
  async retrieveKeycloakAdminCredentials(cheNamespace: string): Promise<string[]> {
    let adminUsername
    let adminPassword

    const cheCluster = await this.kube.getCheCluster(cheNamespace)
    if (!cheCluster) {
      return []
    }
    const keycloakCredentialsSecretName = cheCluster.spec.auth.identityProviderSecret
    if (keycloakCredentialsSecretName) {
      // Keycloak credentials are stored in secret
      const keycloakCredentialsSecret = await this.kube.getSecret(keycloakCredentialsSecretName, cheNamespace)
      if (keycloakCredentialsSecret && keycloakCredentialsSecret.data) {
        adminUsername = base64Decode(keycloakCredentialsSecret.data.user)
        adminPassword = base64Decode(keycloakCredentialsSecret.data.password)
      }
    } else {
      // Keycloak credentials are stored in Che custom resource
      adminUsername = cheCluster.spec.auth.identityProviderAdminUserName
      adminPassword = cheCluster.spec.auth.identityProviderPassword
    }

    return [adminUsername, adminPassword]
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
    return this.kube.namespaceExist(namespace)
  }

  /**
   * DEPRECATED. Use CheApiClient instead.
   */
  async getCheServerStatus(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<string> {
    const cheApi = CheApiClient.getInstance(cheURL + '/api')
    return cheApi.getCheServerStatus(responseTimeoutMs)
  }

  /**
   * DEPRECATED. Use startCheServerShutdown from CheApiClient instead.
   */
  async startShutdown(cheURL: string, accessToken = '', responseTimeoutMs = this.defaultCheResponseTimeoutMs) {
    const cheApi = CheApiClient.getInstance(cheURL + '/api')
    return cheApi.startCheServerShutdown(accessToken, responseTimeoutMs)
  }

  /**
   * DEPRECATED. Use waitUntilCheServerReadyToShutdown from CheApiClient instead.
   */
  async waitUntilReadyToShutdown(cheURL: string, intervalMs = 500, timeoutMs = 60000) {
    const cheApi = CheApiClient.getInstance(cheURL + '/api')
    return cheApi.waitUntilCheServerReadyToShutdown(intervalMs, timeoutMs)
  }

  /**
   * DEPRECATED. Use CheApiClient instead.
   */
  async isCheServerReady(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const cheApi = CheApiClient.getInstance(cheURL + '/api')
    return cheApi.isCheServerReady(responseTimeoutMs)
  }

  async createWorkspaceFromDevfile(cheApiUrl: string, devfilePath: string, workspaceName?: string, accessToken?: string): Promise<chetypes.workspace.Workspace> {
    let devfile: string | undefined
    try {
      devfile = await this.parseDevfile(devfilePath)
      if (workspaceName) {
        let json: Devfile = yaml.load(devfile)
        json.metadata.name = workspaceName
        devfile = yaml.dump(json)
      }
    } catch (error) {
      if (!devfile) {
        throw new Error(`E_NOT_FOUND_DEVFILE - ${devfilePath} - ${error.message}`)
      }
    }

    const cheApi = CheApiClient.getInstance(cheApiUrl)
    return cheApi.createWorkspaceFromDevfile(devfile, accessToken)
  }

  async parseDevfile(devfilePath = ''): Promise<string> {
    if (devfilePath.startsWith('http')) {
      const response = await this.axios.get(devfilePath)
      return response.data
    } else {
      return fs.readFileSync(devfilePath, 'utf8')
    }
  }

  /**
   * DEPRECATED. Use CheApiClient instead.
   */
  async isAuthenticationEnabled(cheURL: string, responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const cheApi = CheApiClient.getInstance(cheURL + '/api')
    return cheApi.isAuthenticationEnabled(responseTimeoutMs)
  }

  async buildDashboardURL(ideURL: string): Promise<string> {
    return ideURL.replace(/\/[^/|.]*\/[^/|.]*$/g, '\/dashboard\/#\/ide$&')
  }

  /**
   * Finds workspace pods and reads logs from it.
   */
  async readWorkspacePodLog(namespace: string, workspaceId: string, directory: string): Promise<boolean> {
    const podLabelSelector = `che.workspace_id=${workspaceId}`

    let workspaceIsRun = false

    const pods = await this.kube.listNamespacedPod(namespace, undefined, podLabelSelector)
    if (pods.items.length) {
      workspaceIsRun = true
    }

    for (const pod of pods.items) {
      for (const containerStatus of pod.status!.containerStatuses!) {
        workspaceIsRun = workspaceIsRun && !!containerStatus.state && !!containerStatus.state.running
      }
    }

    const follow = !workspaceIsRun
    await this.readPodLog(namespace, podLabelSelector, directory, follow)
    await this.readNamespaceEvents(namespace, directory, follow)

    return workspaceIsRun
  }

  /**
   * Reads logs from pods that match a given selector.
   */
  async readPodLog(namespace: string, podLabelSelector: string | undefined, directory: string, follow: boolean): Promise<void> {
    if (follow) {
      await this.watchNamespacedPods(namespace, podLabelSelector, directory)
    } else {
      await this.readNamespacedPodLog(namespace, podLabelSelector, directory)
    }
  }

  /**
   * Reads containers logs inside pod that match a given selector.
   */
  async readNamespacedPodLog(namespace: string, podLabelSelector: string | undefined, directory: string): Promise<void> {
    const pods = await this.kube.listNamespacedPod(namespace, undefined, podLabelSelector)

    for (const pod of pods.items) {
      if (!pod.status || !pod.status.containerStatuses) {
        return
      }

      const podName = pod.metadata!.name!
      for (const containerName of this.getContainers(pod)) {
        const fileName = this.doCreateLogFile(namespace, podName, containerName, directory)
        await this.doReadNamespacedPodLog(namespace, podName, containerName, fileName, false)
      }
    }
  }

  /**
   * Reads all namespace events and store into a file.
   */
  async readNamespaceEvents(namespace: string, directory: string, follow: boolean): Promise<void> {
    const fileName = path.resolve(directory, namespace, 'events.txt')
    fs.ensureFileSync(fileName)

    const cli = (commandExists.sync('kubectl') && 'kubectl') || (commandExists.sync('oc') && 'oc')
    if (cli) {
      const command = 'get events'
      const namespaceParam = `-n ${namespace}`
      const watchParam = follow && '--watch' || ''

      cp.exec(`${cli} ${command} ${namespaceParam} ${watchParam} >> ${fileName}`)
    } else {
      throw new Error('No events are collected. \'kubectl\' or \'oc\' is required to perform the task.')
    }
  }

  async watchNamespacedPods(namespace: string, podLabelSelector: string | undefined, directory: string): Promise<void> {
    const processedContainers = new Map<string, Set<string>>()

    const watcher = new Watch(KubeHelper.KUBE_CONFIG)
    watcher.watch(`/api/v1/namespaces/${namespace}/pods`, {},
      async (_phase: string, obj: any) => {
        const pod = obj as V1Pod
        if (!pod || !pod.metadata || !pod.metadata.name) {
          return
        }
        const podName = pod.metadata.name!

        if (!processedContainers.has(podName)) {
          processedContainers.set(podName, new Set<string>())
        }

        if (!podLabelSelector || this.matchLabels(pod.metadata!.labels || {}, podLabelSelector)) {
          for (const containerName of this.getContainers(pod)) {
            // not to read logs from the same containers twice
            if (!processedContainers.get(podName)!.has(containerName)) {
              processedContainers.get(podName)!.add(containerName)

              const fileName = this.doCreateLogFile(namespace, podName, containerName, directory)
              await this.doReadNamespacedPodLog(namespace, pod.metadata!.name!, containerName, fileName, true)
            }
          }
        }
      },
      // ignore errors
      () => { })
  }

  /**
   * Indicates if pod matches given labels.
   */
  private matchLabels(podLabels: { [key: string]: string }, podLabelSelector: string): boolean {
    const labels = podLabelSelector.split(',')
    for (const label of labels) {
      if (label) {
        const keyValue = label.split('=')
        if (podLabels[keyValue[0]] !== keyValue[1]) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Returns containers names.
   */
  private getContainers(pod: V1Pod): string[] {
    if (!pod.status || !pod.status.containerStatuses) {
      return []
    }
    return pod.status.containerStatuses.map(containerStatus => containerStatus.name)
  }

  /**
   * Reads pod log from a specific container of the pod.
   */
  private async doReadNamespacedPodLog(namespace: string, podName: string, containerName: string, fileName: string, follow: boolean): Promise<void> {
    if (follow) {
      try {
        await this.kube.readNamespacedPodLog(podName, namespace, containerName, fileName, follow)
      } catch {
        // retry in 200ms, container might not be started
        setTimeout(async () => this.doReadNamespacedPodLog(namespace, podName, containerName, fileName, follow), 200)
      }
    } else {
      await this.kube.readNamespacedPodLog(podName, namespace, containerName, fileName, follow)
    }
  }

  private doCreateLogFile(namespace: string, podName: string, containerName: string, directory: string): string {
    const fileName = path.resolve(directory, namespace, podName, `${containerName}.log`)
    fs.ensureFileSync(fileName)

    return fileName
  }

}
