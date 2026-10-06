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

import { writeFileSync } from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import cli from 'cli-ux'
import * as k8s from '@kubernetes/client-node'
import { establishPortForward, generateHostEntry, isPortAvailable } from './utils/cluster'
import { ensureWorkspaceConfigIncluded, ensureExists, writeKeyFile } from './utils/io'
import { ClusterDiscovery } from './auth/cluster-discovery'
import { KubeClientFactory } from './kubernetes/kube-client-factory'
import { OAuthFlow } from './auth/oauth-flow'
import { WorkspaceManager } from './workspace/workspace-manager'
import { execOnPod, findWorkspacePodAndContainer } from './kubernetes/exec-helper'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'
import { ux } from '@oclif/core'

/**
 * Connect to a DevWorkspace given either a che://... URI or a workspace name.
 */
export async function connect(connectArg: string | undefined, wm: WorkspaceManager, kubeConfig: k8s.KubeConfig, cheUrl: string): Promise<void> {
    if (connectArg && URL.parse(connectArg)) {
        // A parseable URL means we were handed a che://... connection URI.
        await connectCheURI(connectArg)
    } else if (connectArg) {
        // Otherwise treat the argument as a workspace name.
        await connectDevworkspaceName(connectArg, wm, kubeConfig, cheUrl)
    } else {
        await connectCheURI(connectArg)
    }
}

export async function handleVSCodeURI(uri: URL) {
    const qParams = new URLSearchParams(uri.searchParams)
    const namespace = qParams.get('namespace')
    const podName = qParams.get('podName')
    const dwName = qParams.get('dwName')
    const userName = qParams.get('userName')
    let keyContent = qParams.get('key')
    let dashboardURL = qParams.get('url')
    ux.log(`Connecting to dwName: ${dwName}, namespace: ${namespace}, podName: ${podName}, userName: ${userName}, dashboardURL: ${dashboardURL}`)

    if (!namespace || !podName || !dwName || !userName || !dashboardURL) {
        return
    }

    if (!hasValidParameters({ namespace, podName, dwName, userName })) {
        return
    }

    if (keyContent) {
        keyContent = Buffer.from(keyContent, 'base64').toString()
    }
    dashboardURL = decodeURIComponent(dashboardURL)

    // Discover cluster endpoints
    const clusterDiscovery = new ClusterDiscovery()
    const endpoints = await clusterDiscovery.discover(dashboardURL)

    // Execute OAuth authorization code flow with PKCE (same as `oc login --web`)
    const oauthFlow = new OAuthFlow()
    const { accessToken } = await oauthFlow.execute(
        endpoints.oauthAuthorizeUrl,
        endpoints.oauthTokenUrl
    )

    const kubeClientFactory = new KubeClientFactory()
    const kubeConfig = kubeClientFactory.createConfig(endpoints.apiUrl, accessToken)

    const sshConfigDir = path.join(homedir(), '.ssh')
    const sshConfigFile = path.join(sshConfigDir, 'config')
    const workspaceConfigFile = path.join(sshConfigDir, 'cluster.conf')
    ensureExists(sshConfigDir)

    let privateKeyFile
    if (keyContent) {
        privateKeyFile = writeKeyFile(`${podName}.key`, keyContent)
    }
    const localPort = await establishPortForward(namespace, podName, 2022, kubeConfig)
    const workspaceHostEntry = generateHostEntry(podName, dwName, localPort, userName, privateKeyFile)

    writeFileSync(workspaceConfigFile, workspaceHostEntry)
    ensureWorkspaceConfigIncluded(sshConfigFile, workspaceConfigFile)

    ux.log(`Verifying port ${localPort} is set up.`)

    if (!await isPortAvailable(localPort, 1000)) {
        ux.log(`Failed to verify connection on ${localPort}`)
    }

    ux.info(`Connection setup completed! Please connect to SSH Host alias: ${dwName}`)

    // TODO : Make this generic
    ux.info(`For Codex App: codex://settings/connections/ssh/add?name=${dwName}&enabled=true`)
    await cli.open(`codex://settings/connections/ssh/add?name=${dwName}&enabled=true`)
}

function hasValidParameters({ namespace, podName, dwName, userName }: {namespace?: string, podName?: string, dwName?: string, userName?: string}): boolean {
    // https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#dns-label-names
    const KB_NAME_PATTERN = '^(([a-z0-9][-a-z0-9]*)?[a-z0-9])?$'
    // https://github.com/eclipse-che/che-dashboard/blob/main/packages/dashboard-frontend/src/pages/WorkspaceDetails/OverviewTab/WorkspaceName/index.tsx
    const DW_NAME_PATTERN = '^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$'
    const USERNAME_PATTERN = '^[a-zA-Z0-9_.-]+$'

    let message = ''
    if (namespace && !namespace.match(KB_NAME_PATTERN)) {
        message += `, ${namespace}`
    }

    if (podName && !podName.match(KB_NAME_PATTERN)) {
        message += `, ${podName}`
    }

    if (dwName && !dwName.match(DW_NAME_PATTERN)) {
        message += `, ${dwName}`
    }

    if (userName && !userName.match(USERNAME_PATTERN)) {
        message += `, ${userName}`
    }

    if (message.length > 0) {
        ux.log(`The following parameters are not valid : ${message.substring(1)}`)
        return false
    }

    return true
}

async function connectCheURI(cheUri: string | undefined) {
    if (!cheUri) {
        try {
            cheUri = await cli.prompt('Please enter the Developer Workspace URI') as string
        } catch (error) {
            ux.error(error instanceof Error ? error : String(error))
        }
    }

    ux.log(`${EclipseChe.PRODUCT_NAME} Workspace URI : ${cheUri}`)

    if (!cheUri) {
        return
    }
    const url = URL.parse(cheUri)
    if (!url) {
        return
    }
    await handleVSCodeURI(url)
}

async function connectDevworkspaceName(workspaceName: string, wm: WorkspaceManager, kubeConfig: k8s.KubeConfig, cheUrl: string) {
    if (!hasValidParameters({ dwName: workspaceName })) {
      return
    }

    const workspace = await wm.startWorkspace(workspaceName)

    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api)

    const podInfo = await findWorkspacePodAndContainer(kubeConfig, workspace.namespace, workspace.devworkspaceId)
    // Discover main container name
    const mainContainerName = podInfo.containerName

    const pod = await coreApi.readNamespacedPod({ name: podInfo.podName, namespace: workspace.namespace })
    const containers = pod.spec?.containers ?? []
    const isCheCodeSSHD = containers.some(c => c.name === 'che-code-sshd-page')
    if (isCheCodeSSHD) {
        // Read SSH username from main container
        const sshUsername = await execOnPod(kubeConfig,
            workspace.namespace, podInfo.podName, mainContainerName,
            'cat /sshd/username'
        )

        let encodedPrivateKey
        // Read private key from main container
        try {
            const privateKey = await execOnPod(kubeConfig,
                workspace.namespace, podInfo.podName, mainContainerName,
                '[ -e /etc/ssh/dwo_ssh_key ] && cat /etc/ssh/dwo_ssh_key || cat /sshd/ssh_client_*key'
            )
            if (privateKey) {
                encodedPrivateKey = Buffer.from(privateKey + '\n').toString('base64url')
            }
        } catch {
            // continue
        }

        const encodedUrl = encodeURIComponent(cheUrl)
        let cheUri = `${EclipseChe.CHE_FLAVOR}://redhat.devspaces-remote-ssh?namespace=${workspace.namespace}&podName=${podInfo.podName}&userName=${sshUsername}&dwName=${workspaceName}&url=${encodedUrl}`
        if (encodedPrivateKey) {
            cheUri += `&key=${encodedPrivateKey}`
        }

        await connectCheURI(cheUri)
    }
}
