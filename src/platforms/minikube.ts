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

export class MinikubeHelper {
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
      { title: 'Verify if minikube is installed',
        task: () => {
          if (!commandExists.sync('minikube')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          }
        }
      },
      { title: 'Verify if minikube is running',
        task: async (ctx: any) => {
          ctx.isMinikubeRunning = await this.isMinikubeRunning()
        }
      },
      { title: 'Start minikube',
        skip: (ctx: any) => {
          if (ctx.isMinikubeRunning) {
            return 'Minikube is already running.'
          }
        },
        task: () => this.startMinikube()
      },
      { title: 'Verify userland-proxy is disabled',
        task: async (_ctx: any, task: any) => {
          const userlandDisabled = await this.isUserLandDisabled()
          if (!userlandDisabled) {
            command.error(`E_PLATFORM_NOT_COMPLIANT_USERLAND: userland-proxy=false parameter is required on docker daemon but it was not found.
            This setting is given when originally starting minikube. (you can then later check by performing command : minikube ssh -- ps auxwwww | grep dockerd
            It needs to contain --userland-proxy=false
            Command that needs to be added on top of your start command:
            $ minikube start <all your existing-options> --docker-opt userland-proxy=false
            Note: you may have to recreate the minikube installation.
            `)
          } else {
            task.title = `${task.title}...done.`
          }
        }
      },
      // { title: 'Verify minikube memory configuration', skip: () => 'Not implemented yet', task: () => {}},
      // { title: 'Verify kubernetes version', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if minikube ingress addon is enabled',
        task: async (ctx: any) => {
          ctx.isIngressAddonEnabled = await this.isIngressAddonEnabled()
        }
      },
      { title: 'Enable minikube ingress addon',
        skip: (ctx: any) => {
          if (ctx.isIngressAddonEnabled) {
            return 'Ingress addon is already enabled.'
          }
        },
        task: () => this.enableIngressAddon()
      },
      { title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => flags.domain !== undefined,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMinikubeIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...${flags.domain}.`
        }
      },
    ])
  }

  async isMinikubeRunning(): Promise<boolean> {
    const { code } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g', '--docker-opt', 'userland-proxy=false'], { timeout: 180000 })
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

  /**
   * Check if userland-proxy=false is set in docker daemon options
   * if not, return an error
   */
  async isUserLandDisabled(): Promise<boolean> {
    const {stdout} = await execa('minikube', ['ssh', '--', 'ps', 'auxwww', '|', 'grep dockerd'], { timeout: 10000 })
    return stdout.includes('--userland-proxy=false')
  }
}
