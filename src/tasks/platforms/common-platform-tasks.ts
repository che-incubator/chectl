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

import * as http from 'http'
import * as https from 'https'
import * as Listr from 'listr'

export namespace CommonPlatformTasks {
  /**
   * Checks whether cluster on which Che is being deployed accessible.
   * Requires flags.domain to be set.
   */
  export function getPingClusterTask(flags: any): Listr.ListrTask {
    return {
      title: 'Check if cluster accessible',
      skip: () => true,
      task: async (_ctx: any, task: any) => {
        const domain: string = flags.domain
        if (!domain) {
          task.title = `${task.title}... "--domain" flag is not set. Cannot check cluster availability.'`
          return
        }

        if (!await checkHttpServer(domain, 80) && !await checkHttpsServer(domain, 443)) {
          throw new Error(`Cannot reach cluster at "${domain}". To skip this check add "--skip-cluster-availability-check" flag.`)
        }

        task.title = `${task.title}...[OK]`
      },
    }
  }

  /**
   * Sends request to given server to check if it is accessible.
   */
  function checkHttpServer(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      http.get({ host, port }, response => {
        // It is ok to have 404, but not 5xx
        if (response.statusCode && response.statusCode / 100 < 5) {
          resolve(true)
        }
        resolve(false)
      }).on('error', () => {
        resolve(false)
      })
    })
  }

  function checkHttpsServer(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      https.get({ host, port }, response => {
        // It is ok to have 404, but not 5xx
        if (response.statusCode && response.statusCode / 100 < 5) {
          resolve(true)
        }
        resolve(false)
      }).on('error', (err: any) => {
        if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          // Connection is estabilished but the server has self-signed certificate, it's ok.
          resolve(true)
        }
        resolve(false)
      })
    })
  }
}
