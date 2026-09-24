/**
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/kubernetes/execHelper.ts

import * as stream from 'stream'
import * as k8s from '@kubernetes/client-node'
import { DevWorkspaceResource } from './devworkspace-types'
import { DW_API_GROUP, DW_API_VERSION, DW_PLURAL, LABEL_DEVWORKSPACE_ID, SIDECAR_PREFIXES } from '../constants'

export interface PodInfo {
  podName: string;
  containerName: string;
}

/**
 * Execute a bash command on a pod via K8s exec and return stdout.
 */
export function execOnPod(
  kubeConfig: k8s.KubeConfig,
  namespace: string,
  podName: string,
  containerName: string,
  command: string | string[]
): Promise<string> {
  const exec = new k8s.Exec(kubeConfig)
  const cmd = typeof command === 'string' ? ['bash', '-c', command] : command

  return new Promise<string>((resolve, reject) => {
    let stdout = ''
    const stdoutStream = new stream.Writable({
      write(chunk: Buffer, _encoding: string, cb: () => void) {
        stdout += chunk.toString()
        cb()
      },
    })
    const stderrStream = new stream.Writable({
      write(_chunk: Buffer, _encoding: string, cb: () => void) {
        cb()
      },
    })

    exec
      .exec(namespace, podName, containerName, cmd, stdoutStream, stderrStream, null, false,
        (status: k8s.V1Status) => {
          if (status.status === 'Success') {
            resolve(stdout.trim())
          } else {
            reject(new Error(status.message ?? 'Exec failed'))
          }
        }
      )
      .catch(reject)
  })
}

/**
 * Find the workspace pod and its main container for a given DevWorkspace ID.
 *
 * The main container is determined by:
 * 1. Reading the DevWorkspace CR to find the component with mountSources=true
 * 2. Matching that component name to a pod container
 * 3. Falling back to the first non-sidecar container
 */
export async function findWorkspacePodAndContainer(
  kubeConfig: k8s.KubeConfig,
  namespace: string,
  devworkspaceId: string
): Promise<PodInfo> {
  const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api)

  const podList = await coreApi.listNamespacedPod(
    { namespace, labelSelector: `${LABEL_DEVWORKSPACE_ID}=${devworkspaceId}` }
  )

  const pods = podList.items
  if (pods.length === 0) {
    throw new Error(`No running pod found for workspace ${devworkspaceId}`)
  }

  const pod = pods[0]
  const containers = pod?.spec?.containers ?? []

  // Try to determine main container from DevWorkspace CR
  let mainContainerName: string | undefined
  const workspaceName = pod?.metadata?.labels?.['controller.devfile.io/devworkspace_name'] ?? ''

  if (workspaceName) {
    try {
      const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi)
      const body = await customApi.getNamespacedCustomObject(
        { group: DW_API_GROUP, version: DW_API_VERSION, namespace, plural: DW_PLURAL, name: workspaceName }
      )
      const dw = body as DevWorkspaceResource

      const components = dw?.spec?.template?.components ?? []
      for (const comp of components) {
        if (comp.container && comp.container.mountSources !== false) {
          mainContainerName = comp.name
          break
        }
      }
      console.log(`DevWorkspace ${workspaceName}: main container = ${mainContainerName}`)
    } catch (err) {
      console.log(`Could not read DevWorkspace CR: ${err}`)
    }
  }

  // Match component name to pod container
  let mainContainer: k8s.V1Container | undefined
  if (mainContainerName) {
    mainContainer = containers.find(c => c.name === mainContainerName)
  }

  // Fallback: first container that isn't a known sidecar
  if (!mainContainer) {
    mainContainer = containers.find(
      (c: k8s.V1Container) => !SIDECAR_PREFIXES.some(prefix => c.name.startsWith(prefix))
    ) ?? containers[0]
  }

  return {
    podName: pod?.metadata?.name ?? '',
    containerName: mainContainer?.name ?? 'tools',
  }
}
