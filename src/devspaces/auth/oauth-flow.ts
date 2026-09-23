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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/auth/OAuthFlow.ts

import * as http from 'http'
import * as crypto from 'crypto'
import cli from 'cli-ux'
import { postForm, HttpError } from '../utils/http-client'
import { OAUTH_CALLBACK_TIMEOUT } from '../constants'

export interface OAuthResult {
  code: string;
  state: string;
}

/**
 * Executes the OAuth2 Authorization Code flow with PKCE against OpenShift.
 *
 * Uses `openshift-cli-client` — the same built-in OAuth client that `oc login --web` uses.
 * This client accepts localhost redirect URIs and supports PKCE.
 */
export class OAuthFlow {
  /** Generate a cryptographically random code verifier for PKCE. */
  generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  /** Compute the S256 code challenge from a code verifier. */
  computeCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
  }

  /** Generate a random state parameter for CSRF protection. */
  generateState(): string {
    return crypto.randomBytes(16).toString('hex')
  }

  /**
   * Execute the OAuth authorization code flow with PKCE.
   *
   * This mirrors exactly what `oc login --web` does:
   * 1. Start localhost callback server
   * 2. Open browser to authorize URL with PKCE challenge
   * 3. User authenticates via SSO
   * 4. Browser redirects to localhost with auth code
   * 5. Exchange code for token at /oauth/token
   */
  async execute(
    authorizeUrl: string,
    tokenUrl: string
  ): Promise<{ accessToken: string; expiresIn?: number }> {
    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.computeCodeChallenge(codeVerifier)
    const state = this.generateState()

    // Start localhost callback server
    const { server, port, resultPromise } = await this.startCallbackServer(state)

    const redirectUri = `http://127.0.0.1:${port}/callback`

    try {
      // Build authorization URL — same params as `oc login --web`
      const authUrl = new URL(authorizeUrl)
      authUrl.searchParams.set('client_id', 'openshift-cli-client')
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)

      console.log('Opening browser for OAuth authentication...')
      console.log(`Auth URL: ${authUrl.toString()}`)

      await cli.open(authUrl.toString())

      // Wait for callback with the authorization code
      const result = await resultPromise
      console.log('Authorization code received, exchanging for token...')

      // Exchange code for token — same as `oc` does
      const tokenResult = await this.exchangeCodeForToken(
        tokenUrl,
        result.code,
        redirectUri,
        codeVerifier
      )

      console.log('Token obtained successfully')
      return tokenResult
    } finally {
      server.close()
    }
  }

  /**
   * Exchange the authorization code for an access token.
   * Uses the same approach as `oc`: POST to /oauth/token with Basic auth.
   */
  private async exchangeCodeForToken(
    tokenUrl: string,
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<{ accessToken: string; expiresIn?: number }> {
    // openshift-cli-client is a public client (no secret), but oc sends
    // Basic auth with client_id and empty password
    const basicAuth = Buffer.from('openshift-cli-client:').toString('base64')

    try {
      const res = await postForm(
        tokenUrl,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        },
        {
          Authorization: `Basic ${basicAuth}`,
        }
      )

      const json = JSON.parse(res.data)
      if (json.error) {
        throw new Error(`Token exchange failed: ${json.error} - ${json.error_description ?? ''}`)
      }
      if (!json.access_token) {
        throw new Error(`Unexpected token response: ${res.data.slice(0, 200)}`)
      }
      return {
        accessToken: String(json.access_token),
        expiresIn: json.expires_in ? Number(json.expires_in) : undefined,
      }
    } catch (err) {
      if (err instanceof HttpError) {
        // Try to parse error details from the response body
        try {
          const json = JSON.parse(err.responseBody)
          if (json.error) {
            throw new Error(`Token exchange failed: ${json.error} - ${json.error_description ?? ''}`)
          }
        } catch { /* fall through to rethrow */ }
        throw new Error(`Token exchange failed: HTTP ${err.statusCode}`)
      }
      throw err
    }
  }

  /**
   * Start a temporary HTTP server on localhost to receive the OAuth callback.
   */
  private startCallbackServer(
    expectedState: string
  ): Promise<{
    server: http.Server;
    port: number;
    resultPromise: Promise<OAuthResult>;
  }> {
    return new Promise((resolveSetup, rejectSetup) => {
      let resolveResult: (value: OAuthResult) => void
      let rejectResult: (reason: Error) => void

      const resultPromise = new Promise<OAuthResult>((res, rej) => {
        resolveResult = res
        rejectResult = rej
      })

      const server = http.createServer((req, res) => {
        if (!req.url?.startsWith('/callback?') && req.url !== '/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const url = new URL(req.url, `http://127.0.0.1`)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          const desc = url.searchParams.get('error_description') ?? error
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(this.errorPage(desc))
          rejectResult(new Error(`OAuth error: ${desc}`))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(this.errorPage('No authorization code received'))
          rejectResult(new Error('No authorization code in callback'))
          return
        }

        if (!state || state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(this.errorPage('Invalid state parameter'))
          rejectResult(new Error('OAuth state mismatch — possible CSRF attack'))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(this.successPage())
        resolveResult({ code, state: state ?? '' })
      })

      // Listen on a random available port on 127.0.0.1
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          rejectSetup(new Error('Failed to start callback server'))
          return
        }

        console.log(`OAuth callback server listening on port ${addr.port}`)

        // Set a timeout for the entire flow
        const timeout = setTimeout(() => {
          server.close()
          rejectResult(
            new Error('OAuth authentication timed out. Please try again.')
          )
        }, OAUTH_CALLBACK_TIMEOUT)

        // Clear timeout when result is received
        resultPromise.finally(() => clearTimeout(timeout))

        resolveSetup({ server, port: addr.port, resultPromise })
      })

      server.on('error', rejectSetup)
    })
  }

  private successPage(): string {
    return `<!DOCTYPE html>
<html>
<head><title>Dev Spaces - Authenticated</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e1e; color: #cccccc;">
  <div style="text-align: center;">
    <h1 style="color: #4ec9b0;">&#10003; Authentication Successful</h1>
    <p>You can close this tab and return to your IDE.</p>
  </div>
</body>
</html>`
  }

  private errorPage(message: string): string {
    const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return `<!DOCTYPE html>
<html>
<head><title>Dev Spaces - Authentication Failed</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e1e; color: #cccccc;">
  <div style="text-align: center;">
    <h1 style="color: #f44747;">&#10007; Authentication Failed</h1>
    <p>${escaped}</p>
    <p>Please close this tab and try again from the IDE.</p>
  </div>
</body>
</html>`
  }
}
