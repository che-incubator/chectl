/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { HOW_TO_CREATE_USER_OS3 } from '../../constants'

export class MinishiftTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  preflightCheckTasks(flags: any, command: Command): Listr {
    let kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Verify if oc is installed',
        task: (_ctx: any, task: any) => {
          if (!commandExists.sync('oc')) {
            command.error('E_REQUISITE_NOT_FOUND')
          } else {
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Verify if minishift is installed',
        task: (_ctx: any, task: any) => {
          if (!commandExists.sync('minishift')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          } else {
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Verify if minishift is running',
        task: async (_ctx: any, task: any) => {
          const minishiftIsRunning = await this.isMinishiftRunning()
          if (!minishiftIsRunning) {
            command.error('E_PLATFORM_NOT_READY')
          } else {
            task.title = `${task.title}...done.`
          }
        }
      },
      VersionHelper.getOpenShiftCheckVersionTask(flags),
      VersionHelper.getK8sCheckVersionTask(flags),
      {
        title: 'Verify amount "minishift" users',
        enabled: () => flags['os-oauth'],
        task: async (_ctx: any, _task: any) => {
          if (await kube.getAmoutUsers() === 0) {
            command.error(`No real user exists in the "minishift" cluster. Either disable OpenShift OAuth integration("os-oauth" flag) or add at least one user (details in the Help link): "${HOW_TO_CREATE_USER_OS3}"`)
          }
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  async isMinishiftRunning(): Promise<boolean> {
    const { exitCode, stdout } = await execa('minishift', ['status'], { timeout: 60000, reject: false })
    if (exitCode === 0 &&
      stdout.includes('Minishift:  Running') &&
      stdout.includes('OpenShift:  Running')) {
      return true
    } else {
      return false
    }
  }

  async getMinishiftIP(): Promise<string> {
    const { stdout } = await execa('minishift', ['ip'], { timeout: 10000 })
    return stdout
  }

}
