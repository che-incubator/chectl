/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'

export class OpenshiftHelper {
  startTasks(flags: any, command: Command): Listr {
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
      { title: 'Verify if openshift is running',
        task: async (_ctx: any, task: any) => {
          const openshiftIsRunning = await this.isOpenshiftRunning()
          if (!openshiftIsRunning) {
            command.error(`E_PLATFORM_NOT_READY: oc status command failed. If there is no project, please create it before by running "oc new-project ${flags.chenamespace}"`)
          } else {
            task.title = `${task.title}...done.`
          }
        }
      },
      // Should automatically compute route if missing
      { title: 'Verify domain is set',
        task: (_ctx: any, task: any) => {
          if (flags.domain === undefined || flags.domain === '') {
            command.error('E_MISSING_ARGUMENT: the domain parameter needs to be defined.')
          }
          task.title = `${task.title}...set to ${flags.domain}.`
        }
      },
    ], {renderer: flags['listr-renderer'] as any})
  }

  async isOpenshiftRunning(): Promise<boolean> {
    const { code } = await execa('oc', ['status'], { timeout: 60000, reject: false })
    return code === 0
  }

}
