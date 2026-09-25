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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/auth/ClusterDiscovery.ts

import { EclipseChe } from '../../tasks/installers/eclipse-che/eclipse-che';
import { request, HttpError } from '../utils/http-client'

export interface ClusterEndpoints {
  /** The Che dashboard base URL, e.g. https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com */
  cheUrl: string;
  /** The OpenShift API server URL, e.g. https://api.devspc02-1d.zs5b.p1.openshiftapps.com:6443 */
  apiUrl: string;
  /** The OAuth authorization endpoint */
  oauthAuthorizeUrl: string;
  /** The OAuth token endpoint */
  oauthTokenUrl: string;
  /** The cluster apps domain, e.g. apps.devspc02-1d.zs5b.p1.openshiftapps.com */
  appsDomain: string;
}

/**
 * Discovers OpenShift cluster endpoints from any URL the user provides.
 *
 * Handles all these URL patterns:
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/dashboard/#/workspaces
 * - https://devspaces.apps.devspc02-1d.zs5b.p1.openshiftapps.com/284992/flights-mgmt/3100/
 * - https://console-openshift-console.apps.devspc02-1d.zs5b.p1.openshiftapps.com/
 * - https://devspaces.example.com (CNAME alias)
 * - https://api.devspc02-1d.zs5b.p1.openshiftapps.com:6443
 */
export class ClusterDiscovery {
  /**
   * Extract the apps domain from any URL the user pastes.
   *
   * The apps domain is the part after the first subdomain:
   *   devspaces.apps.devspc02-1d.xxx → apps.devspc02-1d.xxx
   *   console-openshift-console.apps.devspc02-1d.xxx → apps.devspc02-1d.xxx
   *
   * For API URLs: api.devspc02-1d.xxx → apps.devspc02-1d.xxx
   * For CNAMEs (e.g. devspaces.example.com): we need to follow the /oauth/start redirect.
   */
  extractAppsDomain(inputUrl: string): string | undefined {
    try {
      const url = new URL(inputUrl)
      const host = url.hostname

      // Pattern 1: api.<cluster-domain> → apps.<cluster-domain>
      if (host.startsWith('api.')) {
        return 'apps.' + host.slice(4)
      }

      // Pattern 2: <something>.apps.<cluster-domain> → apps.<cluster-domain>
      const appsIdx = host.indexOf('.apps.')
      if (appsIdx !== -1) {
        return host.slice(appsIdx + 1) // strip the leading subdomain
      }

      // Pattern 3: apps.<cluster-domain> directly
      if (host.startsWith('apps.')) {
        return host
      }

      // Can't determine from hostname alone (e.g. CNAME alias)
      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * Normalize any user-provided URL into a clean Che base URL.
   * Strips paths, fragments, query params.
   */
  normalizeInputUrl(inputUrl: string): string {
    let url = inputUrl.trim()

    // Add https:// if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    try {
      const parsed = new URL(url)
      // Return just the origin (scheme + host + port)
      return parsed.origin
    } catch {
      return url.replace(/\/+$/, '')
    }
  }

  /**
   * Build the Che dashboard URL from the apps domain.
   */
  buildCheUrl(baseUrl: string): string {
    // This used to be `https://devspaces.${appsDomain}`
    // But this is incorrect, so just reuse cluster URL
    return baseUrl
  }

  /**
   * Discover cluster endpoints from any URL the user provides.
   */
  async discover(inputUrl: string): Promise<ClusterEndpoints> {
    console.log(`Discovering cluster endpoints from: ${inputUrl}`)

    const baseUrl = this.normalizeInputUrl(inputUrl)
    let appsDomain = this.extractAppsDomain(inputUrl)

    // If we couldn't extract from the hostname, try following /oauth/start
    if (!appsDomain) {
      console.log(`Could not extract apps domain from hostname, trying /oauth/start redirect from ${baseUrl}`)
      appsDomain = await this.discoverAppsDomainViaRedirect(baseUrl)
    }

    const apiUrl = await this.buildKubeAPIServerURL(appsDomain)
    const cheUrl = this.buildCheUrl(baseUrl)

    console.log(`Apps domain: ${appsDomain}`)
    console.log(`API URL: ${apiUrl}`)
    console.log(`${EclipseChe.CHE_FLAVOR} URL: ${cheUrl}`)

    // Fetch OAuth metadata from the API server
    const oauthMeta = await this.fetchOAuthMetadata(baseUrl, apiUrl)

    const endpoints: ClusterEndpoints = {
      cheUrl,
      apiUrl,
      oauthAuthorizeUrl: oauthMeta.authorization_endpoint,
      oauthTokenUrl: oauthMeta.token_endpoint,
      appsDomain,
    }

    console.log(`Cluster discovery complete: API=${apiUrl}, ${EclipseChe.CHE_FLAVOR}=${cheUrl}`)
    return endpoints
  }

  async buildKubeAPIServerURL(appsDomain: string): Promise<string> {
    const consoleURL = `https://console-openshift-console.${appsDomain}`
    const clusterBase = appsDomain.replace(/^apps\./, '')
    const defaultApiUrl = `https://api.${clusterBase}:6443`
    try {
      const response = await request({ url: consoleURL, method: 'GET' })
      const html = response.data

      // Find the line with window.SERVER_FLAGS = {...};
      // https://github.com/openshift/console/blob/release-4.21/frontend/public/index.html#L62
      // https://github.com/openshift/console/blob/release-4.21/pkg/server/server.go#L805-L811
      // https://github.com/openshift/console/blob/release-4.21/pkg/server/server.go#L124
      const match = html.match(/window\.SERVER_FLAGS\s*=\s*({[\s\S]*?});/)

      if (!match || !match[1]) {
        console.log(`Could not find SERVER_FLAGS in ${consoleURL} HTML response`)
        console.log(`Falling back to ${defaultApiUrl}`)
        return defaultApiUrl
      }

      const serverFlags = JSON.parse(match[1])
      return serverFlags.kubeAPIServerURL
    } catch (err) {
      console.log(`Failed to derive the Kubernetes API Server URL : ${err}`)
      console.log(`Falling back to ${defaultApiUrl}`)
      return defaultApiUrl;
    }
  }

  /**
   * Discover the apps domain by following the Che /oauth/start redirect.
   * Used as a fallback when the URL is a CNAME (e.g. devspaces.example.com).
   */
  private async discoverAppsDomainViaRedirect(baseUrl: string): Promise<string> {
    const url = `${baseUrl}/oauth/start`
    console.log(`Following redirect from ${url}`)

    try {
      await request({ url, method: 'GET', headers: { Accept: 'text/html' } })
      // If we got a 2xx, there's no redirect — can't discover the domain
      throw new Error(
        `Could not discover cluster from ${baseUrl}. ` +
        `Expected redirect from /oauth/start. ` +
        `Try pasting a URL that contains the cluster domain (e.g. devspaces.example.com).`
      )
    } catch (err) {
      if (err instanceof HttpError && err.statusCode >= 300 && err.statusCode < 400) {
        const location = err.responseHeaders.location
        if (location) {
          const locationStr = Array.isArray(location) ? location[0] ?? '' : location
          try {
            const host = new URL(locationStr).hostname
            // oauth-openshift.apps.<cluster-domain> → apps.<cluster-domain>
            const appsDomain = host.replace(/^oauth-openshift\./, '')
            if (appsDomain.startsWith('apps.')) {
              return appsDomain
            }
          } catch { /* fall through */ }
        }
        throw new Error(
          `Could not discover cluster from ${baseUrl}. ` +
          `No valid redirect from /oauth/start (status: ${err.statusCode}). ` +
          `Try pasting a URL that contains the cluster domain (e.g. devspaces.example.com).`
        )
      }
      throw err
    }
  }

  /**
   * Fetch the OAuth metadata from the OpenShift API server.
   */
  private async fetchOAuthMetadata(
    baseUrl: string,
    apiUrl: string
  ): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
    // Try API server first
    try {
      const url = `${apiUrl}/.well-known/oauth-authorization-server`
      console.log(`Fetching OAuth metadata from ${url}`)
      const res = await request({ url, method: 'GET' })
      const meta = JSON.parse(res.data)
      if (meta.authorization_endpoint && meta.token_endpoint) {
        return meta
      }
    } catch (apiErr) {
      console.log(`Failed to fetch OAuth metadata from ${apiUrl}: ${apiErr}`)
    }

    // Fallback: follow /oauth/start redirect to find OAuth server
    try {
      const url = `${baseUrl}/oauth/start`
      console.log(`Following redirect from ${url} to discover OAuth endpoints`)
      await request({ url, method: 'GET', headers: { Accept: 'text/html' } })
      // If we got a 2xx, there's no redirect
      throw new Error(`Could not discover OAuth endpoints from ${baseUrl}: no redirect from /oauth/start`)
    } catch (err) {
      if (err instanceof HttpError && err.statusCode >= 300 && err.statusCode < 400) {
        const location = err.responseHeaders.location
        if (location && location[0]) {
          const locationStr = Array.isArray(location) ? location[0] : location
          try {
            const oauthServerUrl = new URL(locationStr).origin
            console.log(`Discovered OAuth server from redirect: ${oauthServerUrl}`)
            return {
              authorization_endpoint: `${oauthServerUrl}/oauth/authorize`,
              token_endpoint: `${oauthServerUrl}/oauth/token`,
            }
          } catch { /* fall through */ }
        }
      }
      throw err instanceof Error ?
        new Error(`Failed to discover OAuth endpoints: ${err.message}`) :
        new Error(`Failed to discover OAuth endpoints`)
    }
  }
}
