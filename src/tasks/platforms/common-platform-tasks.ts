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
import * as fs from 'fs-extra'
import * as http from 'http'
import * as https from 'https'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'
import { DOCS_LINK_HOW_TO_ADD_IDENTITY_PROVIDER_OS4, DOCS_LINK_HOW_TO_CREATE_USER_OS3 } from '../../constants'
import { isOpenshiftPlatformFamily } from '../../util'

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
      enabled: () => isOpenshiftPlatformFamily(flags.platform) && isOAuthEnabled(flags),
      task: async (ctx: any, task: any) => {
        if (await kube.isOpenShift4()) {
          const providers = await kube.getOpenshiftAuthProviders()
          if (!providers || providers.length === 0) {
            ctx.highlightedMessages.push(`❗ ${ansi.yellow('[WARNING]')} 'os-oauth' flag was disabled, because Openshift oauth hasn't got any identity providers. ${DOCS_LINK_HOW_TO_ADD_IDENTITY_PROVIDER_OS4}`)
            ctx.CROverrides = { spec: { auth: { openShiftoAuth: false } } }
          }
        } else {
          if (await kube.getAmoutUsers() === 0) {
            ctx.highlightedMessages.push(`❗ ${ansi.yellow('[WARNING]')} 'os-oauth' flag was disabled, because Openshift oauth hasn't got any users. See: "${DOCS_LINK_HOW_TO_CREATE_USER_OS3}"`)
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
  function isOAuthEnabled(flags: any): boolean {
    if (flags['che-operator-cr-patch-yaml']) {
      const cheOperatorCrPatchYamlPath = flags['che-operator-cr-patch-yaml']
      if (fs.existsSync(cheOperatorCrPatchYamlPath)) {
        const crPatch = yaml.safeLoad(fs.readFileSync(cheOperatorCrPatchYamlPath).toString())
        if (crPatch && crPatch.spec && crPatch.spec.auth && typeof crPatch.spec.auth.openShiftoAuth === 'boolean') {
          return crPatch.spec.auth.openShiftoAuth
        }
      }
    }

    if (flags['che-operator-cr-yaml']) {
      const cheOperatorCrYamlPath = flags['che-operator-cr-yaml']
      if (fs.existsSync(cheOperatorCrYamlPath)) {
        const cr = yaml.safeLoad(fs.readFileSync(cheOperatorCrYamlPath).toString())
        if (cr && cr.spec && cr.spec.auth && typeof cr.spec.auth.openShiftoAuth === 'boolean') {
          return cr.spec.auth.openShiftoAuth
        }
      }
    }

    return flags['os-oauth'] ? true : false
  }
}
