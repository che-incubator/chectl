/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import execa = require('execa')

export class OpenShiftHelper {
  async status(): Promise<boolean> {
    const command = 'oc'
    const args = ['status']
    const { exitCode } = await execa(command, args, { timeout: 60000, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }
  async getRouteHost(name: string, namespace = ''): Promise<string> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.spec.host}{end}`]
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.trim()
  }
  async getRouteProtocol(name: string, namespace = ''): Promise<string> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.spec.tls.termination}{end}`]
    const { stdout } = await execa(command, args, { timeout: 60000 })
    const termination = stdout.trim()
    if (termination && termination.includes('edge') || termination.includes('passthrough') || termination.includes('reencrypt')) {
      return 'https'
    } else {
      return 'http'
    }
  }
  async routeExist(name: string, namespace = ''): Promise<boolean> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.metadata.name}{end}`]
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.trim().includes(name)
  }
  async deleteAllRoutes(namespace = '') {
    const command = 'oc'
    const args = ['delete', 'route', '--all', '--namespace', namespace]
    await execa(command, args, { timeout: 60000 })
  }
  async deleteAllDeploymentConfigs(namespace = '') {
    const command = 'oc'
    const args = ['delete', 'deploymentconfig', '--all', '--namespace', namespace]
    await execa(command, args, { timeout: 60000 })
  }
}
