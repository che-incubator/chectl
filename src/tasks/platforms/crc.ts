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

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'

import { VersionHelper } from '../../api/version'

/**
 * Helper for Code Ready Container
 */
export class CRCHelper {
  preflightCheckTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if oc is installed',
        task: (_ctx: any, task: any) => {
          if (!commandExists.sync('oc')) {
            command.error('E_REQUISITE_NOT_FOUND')
          } else {
            task.title = `${task.title}...[OK].`
          }
        },
      },
      {
        title: 'Verify if crc is installed',
        task: (_ctx: any, task: any) => {
          if (!commandExists.sync('crc')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          } else {
            task.title = `${task.title}...[OK].`
          }
        },
      },
      {
        title: 'Verify if CodeReady Containers is running',
        task: async (_ctx: any, task: any) => {
          const crcIsRunning = await this.isCRCRunning()
          if (!crcIsRunning) {
            command.error('E_PLATFORM_NOT_READY')
          } else {
            task.title = `${task.title}...[OK].`
          }
        },
      },
      VersionHelper.getOpenShiftCheckVersionTask(flags),
      VersionHelper.getK8sCheckVersionTask(flags),
      {
        title: 'Retrieving CodeReady Containers IP and domain for routes URLs',
        enabled: () => flags.domain !== undefined,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getCRCIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...[${flags.domain}]`
        },
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  async isCRCRunning(): Promise<boolean> {
    const { exitCode, stdout } = await execa('crc', ['status'], { timeout: 60000, reject: false })
    if (exitCode === 0 &&
      stdout.includes('CRC VM:          Running') &&
      stdout.includes('OpenShift:       Running')) {
      return true
    } else {
      return false
    }
  }

  async getCRCIP(): Promise<string> {
    const { stdout } = await execa('crc', ['ip'], { timeout: 10000 })
    return stdout
  }
}
