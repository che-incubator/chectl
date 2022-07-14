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
import * as path from 'path'
import { OpenShiftHelper } from '../api/openshift'
import { CHE_ROOT_CA_SECRET_NAME, ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME, OPENSHIFT_OPERATORS_NAMESPACE } from '../constants'
import { base64Decode } from '../util'
import { ChectlContext } from './context'
import { KubeHelper } from './kube'
import { Subscription } from './types/olm'

export class CheHelper {
  kube: KubeHelper
  oc = new OpenShiftHelper()

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
  }

  async cheURL(namespace: string): Promise<string> {
    if (!await this.kube.getNamespace(namespace)) {
      throw new Error(`ERR_NAMESPACE_NO_EXIST - No namespace ${namespace} is found`)
    }

    const ctx = ChectlContext.get()
    if (ctx[ChectlContext.IS_OPENSHIFT]) {
      return this.cheOpenShiftURL(namespace)
    } else {
      return this.cheK8sURL(namespace)
    }
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

  async cheK8sURL(namespace = ''): Promise<string> {
    const ingress_names = ['che', 'che-ingress']
    for (const ingress_name of ingress_names) {
      if (await this.kube.isIngressExist(ingress_name, namespace)) {
        const hostname = await this.kube.getIngressHost(ingress_name, namespace)
        return `https://${hostname}`
      }
    }
    throw new Error(`ERR_INGRESS_NO_EXIST - No ingress ${ingress_names} in namespace ${namespace}`)
  }

  async cheOpenShiftURL(namespace = ''): Promise<string> {
    const route_names = ['che', 'che-host']
    for (const route_name of route_names) {
      if (await this.oc.routeExist(route_name, namespace)) {
        const hostname = await this.oc.getRouteHost(route_name, namespace)
        return `https://${hostname}`
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

  async findCheOperatorSubscription(namespace: string): Promise<Subscription | undefined> {
    try {
      const subscriptions = await this.kube.listOperatorSubscriptions(namespace)
      const cheSubscriptions = subscriptions.filter(subscription => subscription.spec.name && subscription.spec.name.includes(ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME))
      if (cheSubscriptions.length > 1) {
        throw new Error('Found more than one Che subscription')
      }
      if (cheSubscriptions.length === 1) {
        return cheSubscriptions[0]
      }
      // No subscriptions found, check if Che is installed in all namespaces mode
      if (namespace !== OPENSHIFT_OPERATORS_NAMESPACE) {
        return this.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      }
    } catch {
      // Do nothing, just return undefined
    }
  }
}
