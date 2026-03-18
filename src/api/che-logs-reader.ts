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

import {V1Pod, Watch} from '@kubernetes/client-node'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {KubeClient} from './kube-client'
import {ux} from '@oclif/core'

export class CheLogsReader {
  private kubeHelper: KubeClient

  constructor() {
    this.kubeHelper = KubeClient.getInstance()
  }

  /**
   * Reads logs from pods that match a given selector.
   */
  async readPodLog(namespace: string, podLabelSelector: string | undefined, directory: string, follow: boolean): Promise<void> {
    await (follow ? this.watchNamespacedPods(namespace, podLabelSelector, directory) : this.readNamespacedPodLog(namespace, podLabelSelector, directory))
  }

  /**
   * Reads containers logs inside pod that match a given selector.
   */
  private async readNamespacedPodLog(namespace: string, podLabelSelector: string | undefined, directory: string): Promise<void> {
    const pods = await this.kubeHelper.listNamespacedPod(namespace, undefined, podLabelSelector)

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

    const outStream = fs.createWriteStream(fileName, {flags: 'a'})

    const eventList = await this.kubeHelper.listNamespacedEvent(namespace)
    for (const event of eventList.items) {
      outStream.write(this.formatEvent(event), error => {
        if (error) {
          ux.warn(error)
        }
      })
    }

    if (follow) {
      await this.kubeHelper.watchNamespacedEvents(namespace, event => {
        outStream.write(this.formatEvent(event))
      }, error => {
        if (error) {
          ux.warn(error)
        }
      })
    }
  }

  private formatEvent(event: any): string {
    const lastTimestamp = event.lastTimestamp ? new Date(event.lastTimestamp).toISOString() : '<unknown>'
    const type = event.type || ''
    const reason = event.reason || ''
    const objectKind = event.involvedObject?.kind || ''
    const objectName = event.involvedObject?.name || ''
    const message = event.message || ''
    return `${lastTimestamp}\t${type}\t${reason}\t${objectKind}/${objectName}\t${message}\n`
  }

  private async watchNamespacedPods(namespace: string, podLabelSelector: string | undefined, directory: string): Promise<void> {
    const processedContainers = new Map<string, Set<string>>()

    const watcher = new Watch(this.kubeHelper.getKubeConfig())
    return watcher.watch(`/api/v1/namespaces/${namespace}/pods`, {}, async (_phase: string, obj: any) => {
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
    }, () => {
    })
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

    return pod.status.containerStatuses.filter(s => s.ready).map(s => s.name)
  }

  /**
   * Reads pod log from a specific container of the pod.
   */
  private async doReadNamespacedPodLog(namespace: string, podName: string, containerName: string, fileName: string, follow: boolean): Promise<void> {
    if (follow) {
      try {
        await this.kubeHelper.readNamespacedPodLog(podName, namespace, containerName, fileName, follow)
      } catch {
        // retry in 200ms, container might not be started
        setTimeout(async () => this.doReadNamespacedPodLog(namespace, podName, containerName, fileName, follow), 200)
      }
    } else {
      await this.kubeHelper.readNamespacedPodLog(podName, namespace, containerName, fileName, follow)
    }
  }

  private doCreateLogFile(namespace: string, podName: string, containerName: string, directory: string): string {
    const fileName = path.resolve(directory, namespace, podName, `${containerName}.log`)
    fs.ensureFileSync(fileName)

    return fileName
  }
}
