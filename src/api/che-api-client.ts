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

import axios, { AxiosInstance } from 'axios'
import * as https from 'https'

import { newError, sleep } from '../util'

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
      httpsAgent,
    })
  }

  public static getInstance(cheApiEndpoint: string): CheApiClient {
    cheApiEndpoint = this.normalizeCheApiEndpointUrl(cheApiEndpoint)!
    if (!instance || instance.cheApiEndpoint !== cheApiEndpoint) {
      instance = new CheApiClient(cheApiEndpoint)
    }
    return instance
  }

  public static normalizeCheApiEndpointUrl(url: string) {
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
    this.checkResponse(response, endpoint)
    return response.data.status
  }

  private checkResponse(response: any, endpoint?: string): void {
    if (!response || response.status !== 200 || !response.data) {
      throw new Error(`E_BAD_RESP_CHE_API - Response code: ${response.status}` + endpoint ? `, endpoint: ${endpoint}` : '')
    }
  }

  private getCheApiError(error: any, endpoint: string): Error {
    if (error.response) {
      const status = error.response.status
      if (status === 403) {
        return newError(`E_CHE_API_FORBIDDEN - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data.message)}`, error)
      } else if (status === 401) {
        return newError(`E_CHE_API_UNAUTHORIZED - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data)}`, error)
      } else if (status === 404) {
        return newError(`E_CHE_API_NOTFOUND - Endpoint: ${endpoint} - Message: ${JSON.stringify(error.response.data)}`, error)
      } else if (status === 503) {
        return newError(`E_CHE_API_UNAVAIL - Endpoint: ${endpoint} returned 503 code`, error)
      } else {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        return newError(`E_CHE_API_UNKNOWN_ERROR - Endpoint: ${endpoint} -Status: ${error.response.status}`, error)
      }
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      return newError(`E_CHE_API_NO_RESPONSE - Endpoint: ${endpoint} - Error message: ${error.message}`, error)
    } else {
      // Something happened in setting up the request that triggered an Error
      return newError(`E_CHECTL_UNKNOWN_ERROR - Endpoint: ${endpoint} - Message: ${error.message}`, error)
    }
  }
}
