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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/cluster/ClusterSessionManager.ts

import * as path from 'path'
import { ClusterDiscovery } from '../auth/cluster-discovery'
import { OAuthFlow } from '../auth/oauth-flow'
import { readFile, writeContextFile } from '../utils/io'
import { extStoragePath } from '../constants'
import { KubeClientFactory } from '../kubernetes/kube-client-factory'
import { WorkspaceManager } from '../workspace/workspace-manager'
import { DevWorkspaceApi } from '../kubernetes/devworkspace-api'
import { NamespaceApi } from '../kubernetes/namespace-api'
import { getJson } from '../utils/http-client'
import * as k8s from '@kubernetes/client-node'

export async function initCluster(dashboardURL?: string): Promise<{devspacesUrl: string, wm: WorkspaceManager, kubeConfig: k8s.KubeConfig}> {
    let devspacesUrl
    let apiUrl
    let username
    let token

    if (dashboardURL) {
        // Discover cluster endpoints
        const clusterDiscovery = new ClusterDiscovery()
        const endpoints = await clusterDiscovery.discover(dashboardURL)

        // Execute OAuth authorization code flow with PKCE (same as `oc login --web`)
        const oauthFlow = new OAuthFlow()
        const { accessToken } = await oauthFlow.execute(
            endpoints.oauthAuthorizeUrl,
            endpoints.oauthTokenUrl
        )
        // TODO: What to do with clusterUrl ?
        devspacesUrl = endpoints.devSpacesUrl
        apiUrl = endpoints.apiUrl
        token = accessToken
        username = await discoverUsername(token, apiUrl)

        writeContextFile('context',
        JSON.stringify({
            devspacesUrl: devspacesUrl,
            apiUrl: apiUrl,
            username: username,
            token: token,
        })
    )
    } else {
      const contextFile = path.join(extStoragePath, '.k8s', 'context')
      const context = readFile(contextFile)
      if (!context) {
        throw new Error('No saved Dev Spaces session. Re-run the command with --auth <cluster URL>.')
      }
      ({ devspacesUrl, apiUrl, username, token } = JSON.parse(context))
    }

    const kubeClientFactory = new KubeClientFactory()
    const kubeConfig = kubeClientFactory.createConfig(apiUrl, token)
    const clusterId = urlToId(devspacesUrl)
    const wm = createWorkspaceManager(kubeConfig, clusterId, devspacesUrl, token)
    await wm.initialize(username)

    return { devspacesUrl, wm, kubeConfig }
}

function createWorkspaceManager(kubeConfig: k8s.KubeConfig, clusterId: string, devSpacesUrl: string, accessToken: string): WorkspaceManager {
    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api)
    const customApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi)
    const devWorkspaceApi = new DevWorkspaceApi(customApi, clusterId)
    const namespaceApi = new NamespaceApi(coreApi, customApi, devSpacesUrl, accessToken)
    const wm = new WorkspaceManager(devWorkspaceApi, namespaceApi)
    return wm
}

/**
 * Discover the authenticated user's username from the OpenShift API.
 */
async function discoverUsername(
    accessToken: string,
    apiUrl: string
): Promise<string | undefined> {
    try {
        const user = await getJson<{ metadata?: { name?: string } }>(
            `${apiUrl}/apis/user.openshift.io/v1/users/~`,
            { Authorization: `Bearer ${accessToken}` }
        )
        return user.metadata?.name
    } catch {
        return undefined
    }
}

/**
* Generate a stable ID from a URL.
* Extracts the cluster short prefix from OpenShift apps domains.
* e.g. apps.devspc-1d.ctyz.p1.openshiftapps.com → devspc-1d
* For CNAMEs like devspaces.example.com → devspaces.example.com (keep as-is)
*/
function urlToId(url: string): string {
    try {
        const hostname = new URL(url).hostname
        // Match apps.<cluster-prefix>.<random>.<suffix> pattern (at least 2 segments after prefix)
        const appsIdx = hostname.indexOf('.apps.')
        if (appsIdx !== -1) {
            const afterApps = hostname.slice(appsIdx + '.apps.'.length) // devspc-1d.ctyz.p1.openshiftapps.com
            const parts = afterApps.split('.')
            if (parts.length >= 3 && parts[0]) {
                return parts[0] // cluster short prefix
            }
        }
        if (hostname.startsWith('api.')) {
            const afterApi = hostname.slice('api.'.length)
            const parts = afterApi.split('.')
            if (parts.length >= 3 && parts[0]) {
                return parts[0]
            }
        }
        return hostname
    } catch {
        return url
    }
}
