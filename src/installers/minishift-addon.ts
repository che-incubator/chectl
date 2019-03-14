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

import * as execa from 'execa'
import * as Listr from 'listr'

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

  startTasks(flags: any): Listr {
    return new Listr([
      {
        title: 'Apply Che addon',
        task: async (_ctx: any, task: any) => {
          await this.applyAddon(flags)
          task.title = `${task.title}...done.`
        }
      }
    ])
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
}
