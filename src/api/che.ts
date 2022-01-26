/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { V1Pod, Watch } from '@kubernetes/client-node'
import * as cp from 'child_process'
import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as nodeforge from 'node-forge'
import * as os from 'os'
import * as path from 'path'
import * as rimraf from 'rimraf'
import * as unzipper from 'unzipper'
import { OpenShiftHelper } from '../api/openshift'
import { CHE_ROOT_CA_SECRET_NAME, DEFAULT_CHE_OLM_PACKAGE_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, OPERATOR_TEMPLATE_DIR } from '../constants'
import { base64Decode, downloadFile } from '../util'
import { KubeHelper } from './kube'
import { OperatorGroup, Subscription } from './types/olm'

export class CheHelper {
  defaultCheResponseTimeoutMs = 3000

  kube: KubeHelper
  oc = new OpenShiftHelper()

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
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

  async isSelfSignedCertificateSecretExist(namespace: string): Promise<boolean> {
    const selfSignedCertSecret = await this.kube.getSecret(CHE_ROOT_CA_SECRET_NAME, namespace)
    return Boolean(selfSignedCertSecret)
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

  async chePluginRegistryK8sURL(namespace = ''): Promise<string> {
    if (await this.kube.isIngressExist('plugin-registry', namespace)) {
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
      if (await this.kube.isIngressExist(ingress_name, namespace)) {
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

  buildDashboardURL(cheUrl: string): string {
    return cheUrl.endsWith('/') ? `${cheUrl}dashboard/` : `${cheUrl}/dashboard/`
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

    const tempDir = path.join(os.tmpdir(), Date.now().toString())
    await fs.mkdirp(tempDir)
    const zipFile = path.join(tempDir, `che-templates-${installer}.zip`)
    await downloadFile(url, zipFile)
    await this.unzipTemplates(zipFile, destDir)
    // Clean up zip. Do not wait when finishes.
    rimraf(tempDir, () => { })
  }

  /**
   * Unpacks repository deploy templates into specified folder
   * @param zipFile path to zip archive with source code
   * @param destDir target directory into which templates should be unpacked
   */
  private async unzipTemplates(zipFile: string, destDir: string) {
    // Gets path from: repo-name/deploy/path
    const deployDirRegex = new RegExp('(?:^[\\\w-]*\\\/deploy\\\/)(.*)')
    const configDirRegex = new RegExp('(?:^[\\\w-]*\\\/config\\\/)(.*)')

    const zip = fs.createReadStream(zipFile).pipe(unzipper.Parse({ forceStream: true }))
    for await (const entry of zip) {
      const entryPathInZip: string = entry.path
      const templatesPathMatch = entryPathInZip.match(deployDirRegex) || entryPathInZip.match(configDirRegex)
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

    // Is a new project structure?
    if (fs.existsSync(path.join(destDir, 'manager', 'manager.yaml'))) {
      fs.moveSync(path.join(destDir, 'manager', 'manager.yaml'), path.join(destDir, 'operator.yaml'))
      fs.moveSync(path.join(destDir, 'rbac', 'service_account.yaml'), path.join(destDir, 'service_account.yaml'))
      fs.moveSync(path.join(destDir, 'rbac', 'role.yaml'), path.join(destDir, 'role.yaml'))
      fs.moveSync(path.join(destDir, 'rbac', 'role_binding.yaml'), path.join(destDir, 'role_binding.yaml'))
      fs.moveSync(path.join(destDir, 'rbac', 'cluster_role.yaml'), path.join(destDir, 'cluster_role.yaml'))
      fs.moveSync(path.join(destDir, 'rbac', 'cluster_rolebinding.yaml'), path.join(destDir, 'cluster_rolebinding.yaml'))
      fs.moveSync(path.join(destDir, 'crd', 'bases'), path.join(destDir, 'crds'))
      fs.moveSync(path.join(destDir, 'samples', 'org.eclipse.che_v1_checluster.yaml'), path.join(destDir, 'crds', 'org_v1_che_cr.yaml'))
      fs.moveSync(path.join(destDir, 'samples', 'org_v1_chebackupserverconfiguration.yaml'), path.join(destDir, 'crds', 'org.eclipse.che_v1_chebackupserverconfiguration_cr.yaml'))
      fs.moveSync(path.join(destDir, 'samples', 'org_v1_checlusterbackup.yaml'), path.join(destDir, 'crds', 'org.eclipse.che_v1_checlusterbackup_cr.yaml'))
      fs.moveSync(path.join(destDir, 'samples', 'org_v1_checlusterrestore.yaml'), path.join(destDir, 'crds', 'org.eclipse.che_v1_checlusterrestore_cr.yaml'))
    }
  }

  async findCheOperatorSubscription(namespace: string): Promise<Subscription | undefined> {
    try {
      const subscriptions = await this.kube.listOperatorSubscriptions(namespace)
      const cheSubscriptions = subscriptions.filter(subscription => subscription.spec.name && subscription.spec.name.includes(DEFAULT_CHE_OLM_PACKAGE_NAME))
      if (cheSubscriptions.length > 1) {
        throw new Error('Found more than one Che subscription')
      }
      if (cheSubscriptions.length === 1) {
        return cheSubscriptions[0]
      }
      // No subscriptions found, check if Che is installed in all namespaces mode
      if (namespace !== DEFAULT_OPENSHIFT_OPERATORS_NS_NAME) {
        return this.findCheOperatorSubscription(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
      }
    } catch {
      // Do nothing, just return undefined
    }
  }

  async findCheOperatorOperatorGroup(namespace: string): Promise<OperatorGroup | undefined> {
    const subscription = await this.findCheOperatorSubscription(namespace)
    if (!subscription || !subscription.status || !subscription.status.installedCSV) {
      return
    }

    const csvName = subscription.status.installedCSV
    if (subscription.metadata.namespace) {
      namespace = subscription.metadata.namespace
    }
    const csv = await this.kube.getCSV(csvName, namespace)
    if (!csv || !csv.metadata || !csv.metadata.annotations) {
      return
    }

    const operatorGroupName = csv.metadata.annotations['olm.operatorGroup']
    const operatorGroupNamespace = csv.metadata.annotations['olm.operatorNamespace']
    if (!operatorGroupName || !operatorGroupNamespace) {
      return
    }

    return this.kube.getOperatorGroup(operatorGroupName, operatorGroupNamespace)
  }
}
