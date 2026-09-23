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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/kubernetes/NamespaceApi.ts

import * as k8s from '@kubernetes/client-node'
import { request } from '../utils/http-client'
import { ProjectList } from './devworkspace-types'

/**
 * Discovers the user's DevSpaces namespace.
 *
 * Strategies (tried in order):
 * 1. Conventional name: GET {username}-devspaces (direct, no special perms)
 * 2. Lowercase variant: GET {username.toLowerCase()}-devspaces
 * 3. DevSpaces Server API: GET /api/kubernetes/namespace (works for all users)
 * 4. OpenShift Projects API: list user-scoped projects (no cluster-admin)
 * 5. Cluster-scope namespace list (requires cluster-admin)
 */
export class NamespaceApi {
  constructor(
    private coreApi: k8s.CoreV1Api,
    private customApi?: k8s.CustomObjectsApi,
    private devSpacesUrl?: string,
    private accessToken?: string
  ) {}

  async findUserNamespace(username: string): Promise<string | undefined> {
    console.log(`Looking for namespace for user: ${username}`)

    const result = await this.tryConventionalName(username) ??
      await this.tryLowercaseConventionalName(username) ??
      await this.tryDevSpacesApi(username) ??
      await this.tryProjectsApi(username) ??
      await this.tryListNamespaces(username)

    if (result) {
      console.log(`Namespace resolved: ${result}`)
    } else {
      console.log(`No namespace found for user ${username}`)
    }

    return result
  }

  /**
   * Strategy 1: Direct GET on {username}-devspaces.
   */
  private async tryConventionalName(username: string): Promise<string | undefined> {
    const name = `${username}-devspaces`
    try {
      await this.coreApi.readNamespace(name)
      console.log(`[Strategy 1] Found: ${name}`)
      return name
    } catch {
      console.log(`[Strategy 1] ${name} not found`)
      return undefined
    }
  }

  /**
   * Strategy 2: Direct GET on {username.toLowerCase()}-devspaces.
   */
  private async tryLowercaseConventionalName(username: string): Promise<string | undefined> {
    const lower = username.toLowerCase()
    if (lower === username) {
 return undefined
}

    const name = `${lower}-devspaces`
    try {
      await this.coreApi.readNamespace(name)
      console.log(`[Strategy 2] Found: ${name}`)
      return name
    } catch {
      console.log(`[Strategy 2] ${name} not found`)
      return undefined
    }
  }

  /**
   * Strategy 3: DevSpaces Server API.
   * GET {devSpacesUrl}/api/kubernetes/namespace
   * Returns the user's namespace(s). Works regardless of RBAC.
   */
  private async tryDevSpacesApi(username: string): Promise<string | undefined> {
    if (!this.devSpacesUrl || !this.accessToken) {
      console.log('[Strategy 3] No DevSpaces URL or token, skipping')
      return undefined
    }

    try {
      const apiUrl = `${this.devSpacesUrl}/api/kubernetes/namespace`
      console.log(`[Strategy 3] Querying: ${apiUrl}`)

      const response = await this.httpGet(apiUrl, this.accessToken)
      const namespaces = JSON.parse(response)

      // Response: [{ name: "d9209267-devspaces-heh46u", attributes: {...} }]
      const items = Array.isArray(namespaces) ? namespaces : []
      const lowerUsername = username.toLowerCase()
      const prefix = `${lowerUsername}-devspaces`

      for (const ns of items) {
        const name = ns.name ?? ns.metadata?.name
        if (!name) {
 continue
}

        if (name.startsWith(prefix)) {
          console.log(`[Strategy 3] Found via DevSpaces API: ${name}`)
          return name
        }
      }

      // If only one namespace returned, use it
      if (items.length === 1) {
        const name = items[0].name ?? items[0].metadata?.name
        if (name) {
          console.log(`[Strategy 3] Single namespace from DevSpaces API: ${name}`)
          return name
        }
      }

      console.log(`[Strategy 3] No match in ${items.length} namespaces`)
    } catch (err: any) {
      console.log(`[Strategy 3] DevSpaces API failed: ${err?.message ?? err}`)
    }

    return undefined
  }

  /**
   * Strategy 4: OpenShift Projects API (user-scoped).
   */
  private async tryProjectsApi(username: string): Promise<string | undefined> {
    if (!this.customApi) {
      console.log('[Strategy 4] No CustomObjectsApi, skipping')
      return undefined
    }

    try {
      console.log('[Strategy 4] Listing OpenShift projects...')
      const { body } = await this.customApi.listClusterCustomObject(
        'project.openshift.io', 'v1', 'projects'
      )
      const response = body as ProjectList

      const projects = response?.items ?? []
      console.log(`[Strategy 4] Found ${projects.length} projects`)

      const lowerUsername = username.toLowerCase()
      const prefix = `${lowerUsername}-devspaces`

      for (const project of projects) {
        const name = project.metadata?.name as string | undefined
        if (!name) {
 continue
}

        const cheUsername = project.metadata?.annotations?.['che.eclipse.org/username']
        if (cheUsername && cheUsername.toLowerCase() === lowerUsername) {
          console.log(`[Strategy 4] Found by annotation: ${name}`)
          return name
        }

        if (name.startsWith(prefix)) {
          console.log(`[Strategy 4] Found by prefix: ${name}`)
          return name
        }
      }

      console.log(`[Strategy 4] No match for ${username}`)
    } catch (err: any) {
      console.log(`[Strategy 4] Projects API failed: ${err?.body?.message ?? err?.message ?? err}`)
    }

    return undefined
  }

  /**
   * Strategy 5: List all namespaces (requires cluster-scope permission).
   */
  private async tryListNamespaces(username: string): Promise<string | undefined> {
    try {
      console.log('[Strategy 5] Listing all namespaces...')
      const { body } = await this.coreApi.listNamespace()
      const namespaces = body.items
      console.log(`[Strategy 5] Found ${namespaces.length} namespaces`)

      const lowerUsername = username.toLowerCase()

      for (const ns of namespaces) {
        const nsName = ns.metadata?.name
        const cheUsername = ns.metadata?.annotations?.['che.eclipse.org/username']

        if (cheUsername && cheUsername.toLowerCase() === lowerUsername) {
          console.log(`[Strategy 5] Found by annotation: ${nsName}`)
          return nsName
        }
      }

      console.log(`[Strategy 5] No match for ${username}`)
    } catch (err: any) {
      console.log(`[Strategy 5] Failed: ${err?.body?.message ?? err?.message ?? err}`)
    }

    return undefined
  }

  // ─── HTTP Helper ─────────────────────────────────────────────────────────

  private async httpGet(url: string, token: string): Promise<string> {
    const res = await request({
      url,
      method: 'GET',
      timeout: 10_000,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    return res.data
  }
}
