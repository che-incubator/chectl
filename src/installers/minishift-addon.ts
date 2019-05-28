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

import Command from '@oclif/command'
import * as execa from 'execa'
import * as Listr from 'listr'

import { OpenShiftHelper } from '../api/openshift'

export class MinishiftAddonHelper {
  static getImageRepository(image: string): string {
    if (image.includes(':')) {
      return image.split(':')[0]
    } else {
      return image
    }
  }

  static getImageTag(image: string) {
    if (image.includes(':')) {
      return image.split(':')[1]
    } else {
      return 'latest'
    }
  }

  static async grabVersion(): Promise<number> {
    let args = ['version']
    const { stdout} = await execa('minishift',
                                     args,
                                     {reject: false })
    if (stdout) {
      return parseInt(stdout.replace(/\D/g, '').substring(0, 3), 10)
    }
    return -1

  }

  startTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Check minishift version',
        task: async (_ctx: any, task: any) => {
          const version = await MinishiftAddonHelper.grabVersion()
          if (version < 133) {
            command.error('The minishift che addon is requiring minishift version >= 1.33.0. Please update your minishift installation with "minishift update" command.')
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check logged',
        task: async (_ctx: any, task: any) => {
          await this.checkLogged(command)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check che addon is available',
        task: async (_ctx: any, task: any) => {
          const available = await this.checkAddonIsThere()
          if (!available) {
            command.error('The minishift che addon is not part of the current minishift installation. Please install the addon first. Note: che addon is now part of latest minishift.')
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Apply Che addon',
        task: async (_ctx: any, task: any) => {
          await this.applyAddon(flags)
          task.title = `${task.title}...done.`
        }
      }
    ], {renderer: flags['listr-renderer'] as any})
  }

  async checkLogged(command: Command) {
    const openshiftHelper = new OpenShiftHelper()
    const ok = await openshiftHelper.status()
    if (!ok) {
      command.error('Not logged with OC tool. Please log-in with oc login command')
    }
  }

  async checkAddonIsThere() {
    let args = ['addon', 'list']
    const { stdout} = await execa('minishift',
                                     args,
                                     {reject: false })
    return stdout && stdout.includes('- che')
  }

  async applyAddon(flags: any, execTimeout= 120000) {
    let args = ['addon', 'apply']
    const imageRepo = MinishiftAddonHelper.getImageRepository(flags.cheimage)
    const imageTag = MinishiftAddonHelper.getImageTag(flags.cheimage)
    args = args.concat(['--addon-env', `NAMESPACE=${flags.chenamespace}`])
    args = args.concat(['--addon-env', `CHE_IMAGE_REPO=${imageRepo}`])
    args = args.concat(['--addon-env', `CHE_IMAGE_TAG=${imageTag}`])
    args = args.concat(['che'])
    const { cmd,
            code,
            stderr,
            stdout,
            timedOut } = await execa('minishift',
                                     args,
                                     { timeout: execTimeout, reject: false })
    if (timedOut) {
      throw new Error(`Command "${cmd}" timed out after ${execTimeout}ms
stderr: ${stderr}
stdout: ${stdout}
error: E_TIMEOUT`)
    }
    if (code !== 0) {
      throw new Error(`Command "${cmd}" failed with return code ${code}
stderr: ${stderr}
stdout: ${stdout}
error: E_COMMAND_FAILED`)
    }
  }

  async removeAddon(execTimeout= 120000) {
    let args = ['addon', 'remove', 'che']
    await execa('minishift', args, { timeout: execTimeout, reject: false })
  }

}
