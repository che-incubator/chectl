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

import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'

import {CheCtlContext} from '../../context'
import {CommonTasks} from '../common-tasks'

/**
 * Helper for Code Ready Container
 */
export namespace CRCTasks {
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()
    return [
      CommonTasks.getVerifyCommand('Verify if oc is installed', 'oc not found',  () => commandExists.sync('oc')),
      CommonTasks.getVerifyCommand('Verify if crc is installed', 'crd not found',  () => commandExists.sync('crc')),
      CommonTasks.getVerifyCommand('Verify if CodeReady Containers is running', 'crd not ready',  () => isCRCRunning()),
      {
        title: 'Retrieving CodeReady Containers IP and domain for routes URLs',
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
    const {exitCode, stdout} = await execa('crc', ['status'], {timeout: 60000, reject: false})
    if (exitCode === 0 &&
      stdout.includes('CRC VM:          Running') &&
      stdout.includes('OpenShift:       Running')) {
      return true
    } else {
      return false
    }
  }

  async function getCRCIP(): Promise<string> {
    const {stdout} = await execa('crc', ['ip'], {timeout: 10000})
    return stdout
  }
}
