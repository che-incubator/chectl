/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import ansi = require('ansi-colors')
import * as http from 'http'
import * as https from 'https'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'
import { DOCS_LINK_HOW_TO_ADD_IDENTITY_PROVIDER_OS4, DOCS_LINK_HOW_TO_CREATE_USER_OS3 } from '../../constants'

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

        if (! await checkHttpServer(domain, 80) && ! await checkHttpsServer(domain, 443)) {
          throw new Error(`Cannot reach cluster at "${domain}". To skip this check add "--skip-cluster-availability-check" flag.`)
        }

        task.title = `${task.title}... ok`
      }
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

  export function oAuthProvidersExists(flags: any): Listr.ListrTask {
    let kube = new KubeHelper(flags)
    return {
      title: 'Verify Openshift oauth.',
      enabled: (ctx: any) => ctx.isOpenShift && isOAuthEnabled(ctx),
      task: async (ctx: any, task: any) => {
        if (ctx.isOpenShift4) {
          const providers = await kube.getOpenshiftAuthProviders()
          if (!providers || providers.length === 0) {
            ctx.highlightedMessages.push(`❗ ${ansi.yellow('[WARNING]')} OpenShift OAuth is turned off, because there is no any identity providers configured. ${DOCS_LINK_HOW_TO_ADD_IDENTITY_PROVIDER_OS4}`)
            ctx.CROverrides = { spec: { auth: { openShiftoAuth: false } } }
          }
        } else {
          if (await kube.getUsersNumber() === 0) {
            ctx.highlightedMessages.push(`❗ ${ansi.yellow('[WARNING]')} OpenShift OAuth is turned off, because there are no any users added. See: "${DOCS_LINK_HOW_TO_CREATE_USER_OS3}"`)
            ctx.CROverrides = { spec: { auth: { openShiftoAuth: false } } }
          }
        }
        task.title = `${task.title}...done.`
      }
    }
  }

  /**
   * Checks if Openshift oAuth enabled in Che configuration.
   * Returns true if Openshift oAuth is enabled (or omitted) and false if it is explicitly disabled.
   */
  function isOAuthEnabled(ctx: any): boolean {
    const crPatch = ctx.crPatch
    if (crPatch && crPatch.spec && crPatch.spec.auth && typeof crPatch.spec.auth.openShiftoAuth === 'boolean') {
      return crPatch.spec.auth.openShiftoAuth
    }

    const customCR = ctx.customCR
    if (customCR && customCR.spec && customCR.spec.auth && typeof customCR.spec.auth.openShiftoAuth === 'boolean') {
      return customCR.spec.auth.openShiftoAuth
    }

    return true
  }
}
