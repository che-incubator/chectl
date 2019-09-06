/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import { mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import { ncp } from 'ncp'
import * as path from 'path'

import { OpenShiftHelper } from '../../api/openshift'

export class MinishiftAddonTasks {
  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    let resourcesPath = ''

    return new Listr([
      {
        title: 'Check minishift version',
        task: async (_ctx: any, task: any) => {
          const version = await this.grabVersion()
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
        title: 'Copying addon resources',
        task: async (_ctx: any, task: any) => {
          resourcesPath = await this.copyResources(flags.templates, command.config.cacheDir)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check che addon is available',
        task: async (_ctx: any, task: any) => {
          await this.installAddonIfMissing(resourcesPath)
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
    ], { renderer: flags['listr-renderer'] as any })
  }

  /**
   * Returns list of tasks which perform removing of addon if minishift is found.
   */
  deleteTasks(_flags: any): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: 'Remove Che minishift addon',
      enabled: (ctx: any) => ctx.isOpenShift,
      task: async (_ctx: any, task: any) => {
        if (!commandExists.sync('minishift')) {
          task.title = await `${task.title}...OK (minishift not found)`
        } else {
          await this.removeAddon()
          task.title = await `${task.title}...OK`
        }
      }
    }
    ]
  }

  async removeAddon(execTimeout = 120000) {
    let args = ['addon', 'remove', 'che']
    await execa('minishift', args, { timeout: execTimeout, reject: false })
  }

  getImageRepository(image: string): string {
    if (image.includes(':')) {
      return image.split(':')[0]
    } else {
      return image
    }
  }

  getImageTag(image: string) {
    if (image.includes(':')) {
      return image.split(':')[1]
    } else {
      return 'latest'
    }
  }

  async grabVersion(): Promise<number> {
    let args = ['version']
    const { stdout } = await execa('minishift',
      args,
      { reject: false })
    if (stdout) {
      return parseInt(stdout.replace(/\D/g, '').substring(0, 3), 10)
    }
    return -1

  }

  private async checkLogged(command: Command) {
    const openshiftHelper = new OpenShiftHelper()
    const ok = await openshiftHelper.status()
    if (!ok) {
      command.error('Not logged with OC tool. Please log-in with oc login command')
    }
  }

  private async installAddonIfMissing(resourcesPath: string) {
    let args = ['addon', 'list']
    const { stdout } = await execa('minishift',
      args,
      { reject: false })
    if (stdout && stdout.includes('- che')) {
      // needs to delete before installing
      await this.uninstallAddon()
    }

    // now install
    const addonDir = path.join(resourcesPath, 'che')
    await this.installAddon(addonDir)

  }

  private async applyAddon(flags: any, execTimeout = 120000) {
    let args = ['addon', 'apply']
    const imageRepo = this.getImageRepository(flags.cheimage)
    const imageTag = this.getImageTag(flags.cheimage)
    args = args.concat(['--addon-env', `NAMESPACE=${flags.chenamespace}`])
    args = args.concat(['--addon-env', `CHE_IMAGE_REPO=${imageRepo}`])
    args = args.concat(['--addon-env', `CHE_IMAGE_TAG=${imageTag}`])
    if (flags['devfile-registry-url']) {
      args = args.concat(['--addon-env', `CHE_WORKSPACE_DEVFILE__REGISTRY__URL=${flags['devfile-registry-url']}`])
    }
    if (flags['plugin-registry-url']) {
      args = args.concat(['--addon-env', `CHE_WORKSPACE_PLUGIN__REGISTRY__URL=${flags['plugin-registry-url']}`])
    }
    args = args.concat(['che'])
    const { command,
      exitCode,
      stderr,
      stdout,
      timedOut } = await execa('minishift',
        args,
        { timeout: execTimeout, reject: false })
    if (timedOut) {
      throw new Error(`Command "${command}" timed out after ${execTimeout}ms
stderr: ${stderr}
stdout: ${stdout}
error: E_TIMEOUT`)
    }
    if (exitCode !== 0) {
      throw new Error(`Command "${command}" failed with return code ${exitCode}
stderr: ${stderr}
stdout: ${stdout}
error: E_COMMAND_FAILED`)
    }
  }

  private async installAddon(directory: string, execTimeout = 120000) {
    let args = ['addon', 'install', directory]
    await execa('minishift', args, { timeout: execTimeout })
  }

  private async uninstallAddon(execTimeout = 120000) {
    let args = ['addon', 'uninstall', 'che']
    await execa('minishift', args, { timeout: execTimeout })
  }

  private async copyResources(templatesDir: string, cacheDir: string): Promise<string> {
    const srcDir = path.join(templatesDir, '/minishift-addon/')
    const destDir = path.join(cacheDir, '/templates/minishift-addon/')
    await remove(destDir)
    await mkdirp(destDir)
    await ncp(srcDir, destDir, {}, (err: Error) => { if (err) { throw err } })
    return destDir
  }

}
