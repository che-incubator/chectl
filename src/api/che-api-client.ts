/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { che as chetypes } from '@eclipse-che/api'
import axios, { AxiosInstance } from 'axios'
import { cli } from 'cli-ux'
import * as https from 'https'

import { sleep } from '../util'

/**
 * Singleton responsible for calls to Che API.
 */
let instance: CheApiClient | undefined
export class CheApiClient {
  public defaultCheResponseTimeoutMs = 3000
  public readonly cheApiEndpoint: string

  private readonly axios: AxiosInstance

  private constructor(cheApiEndpoint: string) {
    this.cheApiEndpoint = cheApiEndpoint

    // Make axios ignore untrusted certificate error for self-signed certificate case.
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })

    this.axios = axios.create({
      httpsAgent
    })
  }

  public static getInstance(cheApiEndpoint: string): CheApiClient {
    cheApiEndpoint = this.normalizeCheApiEndpointUrl(cheApiEndpoint)!
    if (!instance || instance.cheApiEndpoint !== cheApiEndpoint) {
      instance = new CheApiClient(cheApiEndpoint)
    }
    return instance
  }

  private static normalizeCheApiEndpointUrl(url: string | undefined) {
    if (url) {
      if (!url.includes('://')) {
        url = 'https://' + url
      }
      const u = new URL(url)
      url = 'https://' + u.host + u.pathname
      if (url.endsWith('/')) {
        url = url.slice(0, -1)
      }
      return url
    }
  }

  /**
   * Checks whether provided url really points to Che server API.
   * Throws an exception if it's not.
   */
  async checkCheApiEndpointUrl(responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<void> {
    try {
      const response = await this.axios.get(`${this.cheApiEndpoint}/system/state`, { timeout: responseTimeoutMs })
      if (response.data && response.data.status) {
        return
      }
    } catch {
      throw new Error(`E_CHE_API_URL_NO_RESPONSE - Failed to connect to "${this.cheApiEndpoint}". Is it the right url?`)
    }
    throw new Error(`E_CHE_API_WRONG_URL - Provided url "${this.cheApiEndpoint}" is not Che API url`)
  }

  async isCheServerReady(responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const id = this.axios.interceptors.response.use(response => response, async (error: any) => {
      if (error.config && error.response && (error.response.status === 404 || error.response.status === 503)) {
        await sleep(500)
        return this.axios.request(error.config)
      }
      return Promise.reject(error)
    })

    try {
      await this.axios.get(`${this.cheApiEndpoint}/system/state`, { timeout: responseTimeoutMs })
      return true
    } catch {
      return false
    } finally {
      this.axios.interceptors.response.eject(id)
    }
  }

  async getCheServerStatus(responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<string> {
    const endpoint = `${this.cheApiEndpoint}/system/state`
    let response = null
    try {
      response = await this.axios.get(endpoint, { timeout: responseTimeoutMs })
    } catch (error) {
      throw this.getCheApiError(error, endpoint)
    }
    if (!response || response.status !== 200 || !response.data || !response.data.status) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
    return response.data.status
  }

  async startCheServerShutdown(accessToken = '', responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<void> {
    const endpoint = `${this.cheApiEndpoint}/system/stop?shutdown=true`
    const headers = accessToken ? { Authorization: accessToken } : null
    let response = null
    try {
      response = await this.axios.post(endpoint, null, { headers, timeout: responseTimeoutMs })
    } catch (error) {
      if (error.response && error.response.status === 409) {
        return
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }
    if (!response || response.status !== 204) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
  }

  async waitUntilCheServerReadyToShutdown(intervalMs = 500, timeoutMs = 60000): Promise<void> {
    const iterations = timeoutMs / intervalMs
    for (let index = 0; index < iterations; index++) {
      let status = await this.getCheServerStatus()
      if (status === 'READY_TO_SHUTDOWN') {
        return
      }
      await cli.wait(intervalMs)
    }
    throw new Error('ERR_TIMEOUT')
  }

  /**
   * Returns list of all workspaces of the user.
   */
  async getAllWorkspaces(accessToken?: string): Promise<chetypes.workspace.Workspace[]> {
    const all: chetypes.workspace.Workspace[] = []
    const itemsPerPage = 30

    let skipCount = 0
    let workspaces: chetypes.workspace.Workspace[]
    do {
      workspaces = await this.getWorkspaces(skipCount, itemsPerPage, accessToken)
      all.push(...workspaces)
      skipCount += workspaces.length
    } while (workspaces.length === itemsPerPage)

    return all
  }

  /**
   * Returns list of workspaces in given range.
   * If lst of all workspaces is needed, getAllWorkspaces should be used insted.
   */
  async getWorkspaces(skipCount = 0, maxItems = 30, accessToken?: string): Promise<chetypes.workspace.Workspace[]> {
    const endpoint = `${this.cheApiEndpoint}/workspace?skipCount=${skipCount}&maxItems=${maxItems}`
    const headers: any = { 'Content-Type': 'text/yaml' }
    if (accessToken && accessToken.length > 0) {
      headers.Authorization = accessToken
    }

    try {
      const response = await this.axios.get(endpoint, { headers })
      if (response && response.data) {
        return response.data
      } else {
        throw new Error('E_BAD_RESP_CHE_SERVER')
      }
    } catch (error) {
      throw this.getCheApiError(error, endpoint)
    }
  }

  async getWorkspaceById(workspaceId: string, accessToken?: string): Promise<chetypes.workspace.Workspace> {
    const endpoint = `${this.cheApiEndpoint}/workspace/${workspaceId}`
    const headers: any = { 'Content-Type': 'text/yaml' }
    if (accessToken) {
      headers.Authorization = accessToken
    }

    try {
      const response = await this.axios.get(endpoint, { headers })
      return response.data
    } catch (error) {
      if (error.response.status === 404) {
        throw new Error(`Workspace ${workspaceId} not found. Please use the command workspace:list to get list of the existed workspaces.`)
      }
      throw this.getCheApiError(error, endpoint)
    }
  }

  async deleteWorkspaceById(workspaceId: string, accessToken?: string): Promise<void> {
    const endpoint = `${this.cheApiEndpoint}/workspace/${workspaceId}`
    const headers: any = {}
    if (accessToken) {
      headers.Authorization = accessToken
    }

    try {
      await this.axios.delete(endpoint, { headers })
    } catch (error) {
      if (error.response.status === 404) {
        throw new Error(`Workspace ${workspaceId} not found. Please use the command workspace:list to get list of the existed workspaces.`)
      } else if (error.response.status === 409) {
        throw new Error('Cannot delete a running workspace. Please stop it using the command workspace:stop and try again')
      }
      throw this.getCheApiError(error, endpoint)
    }
  }

  async startWorkspace(workspaceId: string, debug: boolean, accessToken?: string): Promise<void> {
    let endpoint = `${this.cheApiEndpoint}/workspace/${workspaceId}/runtime`
    if (debug) {
      endpoint += '?debug-workspace-start=true'
    }
    let response

    const headers: { [key: string]: string } = {}
    if (accessToken) {
      headers.Authorization = accessToken
    }
    try {
      response = await this.axios.post(endpoint, undefined, { headers })
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error(`E_WORKSPACE_NOT_EXIST - workspace with "${workspaceId}" id doesn't exist`)
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }

    if (!response || response.status !== 200 || !response.data) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
  }

  async stopWorkspace(workspaceId: string, accessToken?: string): Promise<void> {
    const endpoint = `${this.cheApiEndpoint}/workspace/${workspaceId}/runtime`
    let response

    const headers: { [key: string]: string } = {}
    if (accessToken) {
      headers.Authorization = accessToken
    }
    try {
      response = await this.axios.delete(endpoint, { headers })
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error(`E_WORKSPACE_NOT_EXIST - workspace with "${workspaceId}" id doesn't exist`)
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }

    if (!response || response.status !== 204) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
  }

  async createWorkspaceFromDevfile(devfileContent: string, accessToken?: string): Promise<chetypes.workspace.Workspace> {
    const endpoint = `${this.cheApiEndpoint}/workspace/devfile`
    const headers: any = { 'Content-Type': 'text/yaml' }
    if (accessToken) {
      headers.Authorization = accessToken
    }

    let response: any
    try {
      response = await this.axios.post(endpoint, devfileContent, { headers })
    } catch (error) {
      if (error.response) {
        if (error.response.status === 400) {
          throw new Error(`E_BAD_DEVFILE_FORMAT - Message: ${error.response.data.message}`)
        }
        if (error.response.status === 409) {
          let message = ''
          if (error.response.data) {
            message = error.response.data.message
          }
          throw new Error(`E_CONFLICT - Message: ${message}`)
        }
      }

      throw this.getCheApiError(error, endpoint)
    }

    if (response && response.data) {
      return response.data as chetypes.workspace.Workspace
    } else {
      throw new Error('E_BAD_RESP_CHE_SERVER')
    }
  }

  async isAuthenticationEnabled(responseTimeoutMs = this.defaultCheResponseTimeoutMs): Promise<boolean> {
    const endpoint = `${this.cheApiEndpoint}/keycloak/settings`
    let response = null
    try {
      response = await this.axios.get(endpoint, { timeout: responseTimeoutMs })
    } catch (error) {
      if (error.response && (error.response.status === 404 || error.response.status === 503)) {
        return false
      } else {
        throw this.getCheApiError(error, endpoint)
      }
    }
    if (!response || response.status !== 200 || !response.data) {
      throw new Error('E_BAD_RESP_CHE_API')
    }
    return true
  }

  getCheApiError(error: any, endpoint: string): Error {
    if (error.response) {
      const status = error.response.status
      if (status === 403) {
        return new Error(`E_CHE_API_FORBIDDEN - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data.message)}`)
      } else if (status === 401) {
        return new Error(`E_CHE_API_UNAUTHORIZED - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data)}`)
      } else if (status === 404) {
        return new Error(`E_CHE_API_NOTFOUND - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data)}`)
      } else {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        return new Error(`E_CHE_API_UNKNOWN_ERROR - Endpoint: ${endpoint} -Status: ${error.response.status}`)
      }

    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      return new Error(`E_CHE_API_NO_RESPONSE - Endpoint: ${endpoint} - Error message: ${error.message}`)
    } else {
      // Something happened in setting up the request that triggered an Error
      return new Error(`E_CHECTL_UNKNOWN_ERROR - Endpoint: ${endpoint} - Message: ${error.message}`)
    }
  }

}
