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

import execa = require('execa')

export namespace OpenShift {
  export async function isOpenShiftRunning(): Promise<boolean> {
    const {exitCode} = await execa('oc', ['status', '--namespace', 'default'], {timeout: 60_000, reject: false})
    return exitCode === 0
  }

  export async function getRouteHost(name: string, namespace: string): Promise<string> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.spec.host}{end}`]
    const {stdout} = await execa(command, args, {timeout: 60_000})
    return stdout.trim()
  }

  export async function isRouteExist(name: string, namespace: string): Promise<boolean> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.metadata.name}{end}`]
    const {stdout} = await execa(command, args, {timeout: 60_000})
    return stdout.trim().includes(name)
  }
}
