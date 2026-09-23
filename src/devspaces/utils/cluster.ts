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
import * as http from 'http'
import * as https from 'https'
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

/**
 * Resolves the OpenShift API URL from a DevSpaces workspace URL.
 *
 * Hits the /oauth/start endpoint on the DevSpaces host (unauthenticated) which
 * redirects to oauth-openshift.apps.<cluster-domain>. The cluster domain is
 * extracted and the API URL is derived as https://api.<cluster-domain>:6443.
 * If this approach fails, falls back to extracting host directly from the
 * original URL.
 *
 * Works for both standard (.apps.) and custom domain URLs.
 * Uses Node.js https module instead of curl for cross-platform compatibility.
 */
export async function getOpenShiftApiURL(inputURL: string): Promise<string | undefined> {
    try {
        const host = new URL(inputURL)
        const oauthStartURL = `${host.protocol}//${host.host}/oauth/start`

        console.log(`Discovering cluster API URL via ${oauthStartURL}`)

        // Follow the /oauth/start redirect to discover the real cluster hostname
        const redirectURL = await new Promise<string | undefined>(resolve => {
            const mod = host.protocol === 'https:' ? https : http
            const req = mod.get(oauthStartURL, { rejectUnauthorized: false }, (res: http.IncomingMessage) => {
                if (res.statusCode === 302 && res.headers.location) {
                    resolve(res.headers.location)
                } else {
                    resolve(undefined)
                }
            })
            req.on('error', () => resolve(undefined))
            req.setTimeout(10000, () => {
 req.destroy(); resolve(undefined)
})
        })

        if (redirectURL) {
            // Redirect URL is: https://oauth-openshift.apps.<cluster-domain>/oauth/authorize?...
            // Strip "oauth-openshift.apps." prefix to get the cluster domain
            const oauthHost = new URL(redirectURL).hostname
            const prefix = 'oauth-openshift.apps.'
            if (oauthHost.startsWith(prefix)) {
                const clusterDomain = oauthHost.substring(prefix.length)
                const apiURL = `https://api.${clusterDomain}:6443`
                console.log(`Resolved API URL: ${apiURL}`)
                return apiURL
            } else {
                console.log(`Unexpected OAuth hostname: ${oauthHost}`)
            }
        } else {
            console.log('No redirect received from /oauth/start')
        }

        // Fall back to basic approach
        let key = ''
        if (host.host.indexOf('.apps-') > 0) {
            key = '.apps-'
        } else if (host.host.indexOf('.apps.') > 0) {
            key = '.apps.'
        } else {
            return undefined
        }

        const hostTLD = `${host.host.substring(host.host.indexOf(key) + key.length)}`
        return `${host.protocol}//api.${hostTLD}:6443`
    } catch (err) {
        console.log(String(err))
        return undefined
    }
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
