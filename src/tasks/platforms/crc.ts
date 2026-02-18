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
import * as Listr from 'listr'

import {CheCtlContext} from '../../context'
import {CommonTasks} from '../common-tasks'
import {isCommandExists} from '../../utils/utls'

/**
 * Helper for Code Ready Container
 */
export namespace CRCTasks {
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()
    return [
      CommonTasks.getVerifyCommand('Verify if oc is installed', 'oc not found',  () => isCommandExists('oc')),
      CommonTasks.getVerifyCommand('Verify if OpenShift Local is installed', 'OpenShift Local not found',  () => isCommandExists('crc')),
      CommonTasks.getVerifyCommand('Verify if OpenShift Local is running', 'OpenShift Local not ready',  () => isCRCRunning()),
      {
        title: 'Retrieving OpenShift Local IP and domain for routes URLs',
        enabled: () => flags.domain !== undefined,
        task: async (_ctx: any, task: any) => {
          const ip = await getCRCIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...[${flags.domain}]`
        },
      },
    ]
  }

  async function isCRCRunning(): Promise<boolean> {
    const {exitCode, stdout} = await execa('crc', ['status'], {timeout: 60_000, reject: false})
    return Boolean(exitCode === 0 &&
      stdout.includes('CRC VM:          Running') &&
      stdout.includes('OpenShift:       Running'))
  }

  async function getCRCIP(): Promise<string> {
    const {stdout} = await execa('crc', ['ip'], {timeout: 10_000})
    return stdout
  }
}
