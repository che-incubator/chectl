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

import { sleep } from '../utils/utls'

/**
 * Responsible for calls to Che API.
 */
export class CheServerClient {
  private readonly cheApiEndpoint: string
  private readonly axios: AxiosInstance

  private constructor(cheApiEndpoint: string) {
    this.cheApiEndpoint = cheApiEndpoint
    this.axios = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    })
  }

  public static getInstance(cheApiEndpoint: string): CheServerClient {
    return new CheServerClient(this.normalizeCheApiEndpointUrl(cheApiEndpoint)!)
  }

  private static normalizeCheApiEndpointUrl(url: string) {
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

  async isCheServerReady(responseTimeoutMs = 3000): Promise<boolean> {
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
}
