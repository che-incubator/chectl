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

export class MinikubeTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if kubectl is installed',
        task: () => {
          if (!commandExists.sync('kubectl')) {
            command.error('E_REQUISITE_NOT_FOUND')
          }
        }
      },
      {
        title: 'Verify if minikube is installed',
        task: () => {
          if (!commandExists.sync('minikube')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          }
        }
      },
      {
        title: 'Verify if minikube is running',
        task: async (ctx: any) => {
          ctx.isMinikubeRunning = await this.isMinikubeRunning()
        }
      },
      {
        title: 'Start minikube',
        skip: (ctx: any) => {
          if (ctx.isMinikubeRunning) {
            return 'Minikube is already running.'
          }
        },
        task: () => this.startMinikube()
      },
      // { title: 'Verify minikube memory configuration', skip: () => 'Not implemented yet', task: () => {}},
      // { title: 'Verify kubernetes version', skip: () => 'Not implemented yet', task: () => {}},
      {
        title: 'Verify if minikube ingress addon is enabled',
        task: async (ctx: any) => {
          ctx.isIngressAddonEnabled = await this.isIngressAddonEnabled()
        }
      },
      {
        title: 'Enable minikube ingress addon',
        skip: (ctx: any) => {
          if (ctx.isIngressAddonEnabled) {
            return 'Ingress addon is already enabled.'
          }
        },
        task: () => this.enableIngressAddon()
      },
      {
        title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => !flags.domain,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMinikubeIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...${flags.domain}.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  async isMinikubeRunning(): Promise<boolean> {
    const { exitCode } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: 180000 })
  }

  async isIngressAddonEnabled(): Promise<boolean> {
    const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 10000 })
    if (stdout.includes('ingress: enabled')) { return true } else { return false }
  }

  async enableIngressAddon() {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 10000 })
  }

  async getMinikubeIP(): Promise<string> {
    const { stdout } = await execa('minikube', ['ip'], { timeout: 10000 })
    return stdout
  }

}
