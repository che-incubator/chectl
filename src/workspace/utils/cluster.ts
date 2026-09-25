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

// https://github.com/redhat-developer/devspaces-remote-ssh/blob/main/src/utils/cluster.ts

import { getSavedPorts, rememberPorts } from './io'
import { extStoragePath } from '../constants'
import { platform } from 'os'
import { unlinkSync } from 'fs'
import * as path from 'path'
import * as net from 'net'
import * as k8s from '@kubernetes/client-node'

export class PodInfo {
    project: string | undefined // project
    name: string | undefined // metadata.name
    id: string | undefined // metadata.labels.controller\.devfile\.io/devworkspace_name
    status: string | undefined // status.phase
}

export class PortForwardInfo {
    namespace!: string
    name!: string
    port!: number
    pid?: number | undefined
}

export async function establishPortForward(namespace: string, podName: string, remotePort: number, kubeConfig: k8s.KubeConfig): Promise<number> {
    const forward = new k8s.PortForward(kubeConfig!)
    const server = net.createServer(socket => {
      socket.on('error', (err: Error & { code?: string }) => {
        // ECONNRESET is common when clients disconnect abruptly (test connections, SSH client closes)
        // Only log unexpected errors to avoid spam during normal operation
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
          console.log(`Port forward socket error for ${namespace}/${podName}:${remotePort} - ${err.code}: ${err.message}`)
        }
      })
      forward.portForward(namespace, podName, [remotePort], socket, null, socket)
      .catch((err: Error) => {
          console.info(`Port forward to ${namespace}/${podName}:${remotePort} failed: ${err.message}`)
          socket.destroy()
      })
    })

    const localPort = await new Promise<number>((resolve, reject) => {
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    })

    // Keep server error handler active after startup to catch runtime failures
    server.removeAllListeners('error')
    server.on('error', (err: Error & { code?: string }) => {
      console.log(`Port forward server error for ${namespace}/${podName}:${remotePort} - ${err.code}: ${err.message}`)
    })

    console.info(`Port-forward: localhost:${localPort} → ${podName}:${remotePort}`)
    return localPort
  }

export function generateHostEntry(podName: string, devworkspaceId: string, port: number, userName: string, identityPath: string | undefined): string {
    return [
        `Host ${devworkspaceId}`,
        `  HostName 127.0.0.1`,
        `  Port ${port}`,
        `  User ${userName}`,
        identityPath ? `  IdentityFile ${identityPath}` : null,
        identityPath ? `  IdentitiesOnly yes` : null,
        `  UserKnownHostsFile ${platform() === 'win32' ? 'nul' : '/dev/null'}`,
        `  StrictHostKeyChecking no`,
    ].filter(Boolean).join('\n')
}

export async function getExistingPortForwardEntry(pod: PodInfo): Promise<PortForwardInfo | undefined> {
    const savedPorts: PortForwardInfo[] = getSavedPorts()
    const match = savedPorts.find(pf => pf.name === pod.name && pf.namespace === pod.project)
    if (match?.port && await isPortAvailable(match?.port, 1000)) {
        return match
    }
}

export async function isPortAvailable(port: number, timeout: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket()
                socket.on('connect', () => {
                    socket.end()
                    resolve(true)
                })
                socket.on('error', (err: Error) => {
                    socket.destroy()
                    reject(err)
                })
                socket.connect(port)
            })
            return true
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            await new Promise(r => setTimeout(r, 100))
        }
    }
    return false
}

export async function updatePortForwarding(sshdPods?: PodInfo[], availablePortForwardEntries?: PortForwardInfo[]) {
    const result: PortForwardInfo[] = []
    if (availablePortForwardEntries) {
        result.push(...availablePortForwardEntries)
    }

    for (const pf of getSavedPorts()) {
        const entryExists = result.some(e => e.name === pf.name && e.namespace === pf.namespace && e.port === pf.port)
        const podRunning: boolean = sshdPods ? sshdPods.some(p => p.name === pf.name && p.project === pf.namespace) : false
        const portAvailable = await isPortAvailable(pf.port, 1000)
        console.log(`pid: ${pf.pid} name: ${pf.name} ${podRunning ? '(running)' : '(stopped)'} ns: ${pf.namespace} port: ${pf.port} ${portAvailable ? '(available)' : '(stopped)'}`)
        if (portAvailable && podRunning && !entryExists) {
            result.push(pf)
        } else if (!podRunning) {
            try {
                unlinkSync(path.join(extStoragePath, '.ssh', `${pf.name}.key`))
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (err) {
                // continue
            }
            if (pf.pid) {
                try {
                    // process.kill(pf.pid, "SIGTERM");
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (err) {
                    // continue
                }
            }
        }
    }

    rememberPorts(result)
}
