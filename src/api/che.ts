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
import { cli } from 'cli-ux'
import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as https from 'https'
import * as yaml from 'js-yaml'
import * as nodeforge from 'node-forge'
import * as os from 'os'
import * as path from 'path'
import * as rimraf from 'rimraf'
import * as unzipper from 'unzipper'

import { OpenShiftHelper } from '../api/openshift'
import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_ROOT_CA_SECRET_NAME, DEFAULT_CA_CERT_FILE_NAME, OPERATOR_TEMPLATE_DIR } from '../constants'
import { base64Decode, downloadFile } from '../util'

import { CheApiClient } from './che-api-client'
import { Devfile } from './devfile'
import { KubeHelper } from './kube'

export class CheHelper {
  defaultCheResponseTimeoutMs = 3000
  kube: KubeHelper
  oc = new OpenShiftHelper()

  private readonly axios: AxiosInstance

  constructor(private readonly flags: any) {
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
    const k8sApi = this.kube.kubeConfig.makeApiClient(CoreV1Api)

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
    const k8sApi = this.kube.kubeConfig.makeApiClient(CoreV1Api)

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
    if (!await this.kube.getNamespace(namespace)) {
      throw new Error(`ERR_NAMESPACE_NO_EXIST - No namespace ${namespace} is found`)
    }

    if (await this.kube.isOpenShift()) {
      return this.cheOpenShiftURL(namespace)
    } else {
      return this.cheK8sURL(namespace)
    }
  }

  async chePluginRegistryURL(namespace = ''): Promise<string> {
    // provided through command line ?
    if (this.flags['plugin-registry-url']) {
      return this.flags['plugin-registry-url']
    }
    // check
    if (!await this.kube.getNamespace(namespace)) {
      throw new Error(`ERR_NAMESPACE_NO_EXIST - No namespace ${namespace} is found`)
    }

    // grab URL
    if (await this.kube.isOpenShift()) {
      return this.chePluginRegistryOpenShiftURL(namespace)
    } else {
      return this.chePluginRegistryK8sURL(namespace)
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
    const cheCaSecretContent = await this.getCheSelfSignedSecretContent(cheNamespace)
    if (!cheCaSecretContent) {
      return
    }

    const pemBeginHeader = '-----BEGIN CERTIFICATE-----'
    const pemEndHeader = '-----END CERTIFICATE-----'
    const certRegExp = new RegExp(`(^${pemBeginHeader}$(?:(?!${pemBeginHeader}).)*^${pemEndHeader}$)`, 'mgs')
    const certsPem = cheCaSecretContent.match(certRegExp)

    const caCertsPem: string[] = []
    if (certsPem) {
      for (const certPem of certsPem) {
        const cert = nodeforge.pki.certificateFromPem(certPem)
        const basicConstraintsExt = cert.getExtension('basicConstraints')
        if (basicConstraintsExt && (basicConstraintsExt as any).cA) {
          caCertsPem.push(certPem)
        }
      }
    }

    return caCertsPem.join('\n')
  }

  /**
   * Retrieves content of Che self-signed-certificate secret or undefined if the secret doesn't exist.
   * Note, it contains certificate chain in pem format.
   */
  private async getCheSelfSignedSecretContent(cheNamespace: string): Promise<string | undefined> {
    const cheCaSecret = await this.kube.getSecret(CHE_ROOT_CA_SECRET_NAME, cheNamespace)
    if (!cheCaSecret) {
      return
    }

    if (cheCaSecret.data && cheCaSecret.data['ca.crt']) {
      return base64Decode(cheCaSecret.data['ca.crt'])
    }

    throw new Error(`Secret "${CHE_ROOT_CA_SECRET_NAME}" has invalid format: "ca.crt" key not found in data.`)
  }

  async saveCheCaCert(cheCaCert: string, destination?: string): Promise<string> {
    const cheCaCertFile = this.getTargetFile(destination)
    fs.writeFileSync(cheCaCertFile, cheCaCert)
    return cheCaCertFile
  }

  /**
   * Handles certificate target location and returns string which points to the target file.
   */
  private getTargetFile(destination: string | undefined): string {
    if (!destination) {
      return path.join(os.tmpdir(), DEFAULT_CA_CERT_FILE_NAME)
    }

    if (fs.existsSync(destination)) {
      return fs.lstatSync(destination).isDirectory() ? path.join(destination, DEFAULT_CA_CERT_FILE_NAME) : destination
    }

    throw new Error(`Given path \'${destination}\' doesn't exist.`)
  }

  /**
   * Retrieves Keycloak admin user credentials.
   * Works only with installers which use Che CR (operator, olm).
   * Returns credentials as an array of two values: [login, password]
   * In case of an error an array with undefined values will be returned.
   */
  async retrieveKeycloakAdminCredentials(cheNamespace: string): Promise<string[]> {
    let adminUsername
    let adminPassword

    const cheCluster = await this.kube.getCustomResource(cheNamespace, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, 'checlusters')
    if (!cheCluster || cheCluster.spec.auth.externalIdentityProvider) {
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

  async chePluginRegistryK8sURL(namespace = ''): Promise<string> {
    if (await this.kube.ingressExist('plugin-registry', namespace)) {
      const protocol = await this.kube.getIngressProtocol('plugin-registry', namespace)
      const hostname = await this.kube.getIngressHost('plugin-registry', namespace)
      return `${protocol}://${hostname}`
    }
    throw new Error(`ERR_INGRESS_NO_EXIST - No ingress 'plugin-registry' in namespace ${namespace}`)
  }

  async chePluginRegistryOpenShiftURL(namespace = ''): Promise<string> {
    if (await this.oc.routeExist('plugin-registry', namespace)) {
      const protocol = await this.oc.getRouteProtocol('plugin-registry', namespace)
      const hostname = await this.oc.getRouteHost('plugin-registry', namespace)
      return `${protocol}://${hostname}`
    }
    throw new Error(`ERR_ROUTE_NO_EXIST - No route 'plugin-registry' in namespace ${namespace}`)
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

  async createWorkspaceFromDevfile(cheApiEndpoint: string, devfilePath: string, workspaceName?: string, accessToken?: string): Promise<chetypes.workspace.Workspace> {
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

    const cheApi = CheApiClient.getInstance(cheApiEndpoint)
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

  async buildDashboardURL(ideURL: string): Promise<string> {
    return ideURL.replace(/\/[^/|.]*\/[^/|.]*$/g, '\/dashboard\/#\/ide$&')
  }

  /**
   * Finds workspace pods and reads logs from it.
   */
  async readWorkspacePodLog(namespace: string, workspaceId: string, directory: string, follow: boolean): Promise<void> {
    const podLabelSelector = `che.workspace_id=${workspaceId}`

    await this.readPodLog(namespace, podLabelSelector, directory, follow)
    await this.readNamespaceEvents(namespace, directory, follow)
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

    const watcher = new Watch(this.kube.kubeConfig)
    return watcher.watch(`/api/v1/namespaces/${namespace}/pods`, {},
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
   * Wait until workspace is in 'Active` state.
   */
  async waitNamespaceActive(namespaceName: string, intervalMs = 500, timeoutMs = 60000) {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      const namespace = await this.kube.getNamespace(namespaceName)
      if (namespace && namespace.status && namespace.status.phase && namespace.status.phase === 'Active') {
        return
      }
      await cli.wait(intervalMs)
    }

    throw new Error(`ERR_TIMEOUT: ${namespaceName} is not 'Active'.`)
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

  /**
   * Gets install templates for given installer.
   * @param installer Che installer
   * @param url link to zip archive with sources of Che operator
   * @param destDir destination directory into which the templates should be unpacked
   */
  async downloadAndUnpackTemplates(installer: string, url: string, destDir: string): Promise<void> {
    // Add che-operator folder for operator templates
    if (installer === 'operator') {
      destDir = path.join(destDir, OPERATOR_TEMPLATE_DIR)
    }
    // No need to add kubernetes folder for Helm installer as it already present in the archive

    const tempDir = path.join(os.tmpdir(), Date.now().toString())
    await fs.mkdirp(tempDir)
    const zipFile = path.join(tempDir, `che-templates-${installer}.zip`)
    await downloadFile(url, zipFile)
    await this.unzipTemplates(zipFile, destDir)
    // Clean up zip. Do not wait when finishes.
    rimraf(tempDir, () => {})
  }

  /**
   * Unpacks repository deploy templates into specified folder
   * @param zipFile path to zip archive with source code
   * @param destDir target directory into which templates should be unpacked
   */
  private async unzipTemplates(zipFile: string, destDir: string) {
    // Gets path from: repo-name/deploy/path
    const deployDirRegex = new RegExp('(?:^[\\\w-]*\\\/deploy\\\/)(.*)')

    const zip = fs.createReadStream(zipFile).pipe(unzipper.Parse({ forceStream: true }))
    for await (const entry of zip) {
      const entryPathInZip: string = entry.path
      const templatesPathMatch = entryPathInZip.match(deployDirRegex)
      if (templatesPathMatch && templatesPathMatch.length > 1 && templatesPathMatch[1]) {
        // Remove prefix from in-zip path
        const entryPathWhenExtracted = templatesPathMatch[1]
        // Path to the item in target location
        const dest = path.join(destDir, entryPathWhenExtracted)

        // Extract item
        if (entry.type === 'File') {
          const parentDirName = path.dirname(dest)
          if (!fs.existsSync(parentDirName)) {
            await fs.mkdirp(parentDirName)
          }
          entry.pipe(fs.createWriteStream(dest))
        } else if (entry.type === 'Directory') {
          if (!fs.existsSync(dest)) {
            await fs.mkdirp(dest)
          }
          // The folder is created above
          entry.autodrain()
        } else {
          // Ignore the item as we do not need to handle links and etc.
          entry.autodrain()
        }
      } else {
        // No need to extract this item
        entry.autodrain()
      }
    }
  }

}
