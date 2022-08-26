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

export class MicroK8sTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  preflightCheckTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if kubectl is installed',
        task: () => {
          if (!commandExists.sync('kubectl')) {
            command.error('E_REQUISITE_NOT_FOUND')
          }
        },
      },
      {
        title: 'Verify if microk8s is installed',
        task: () => {
          if (!commandExists.sync('microk8s.status')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          }
        },
      },
      {
        title: 'Verify if microk8s is running',
        task: async (ctx: any) => {
          ctx.isMicroK8sRunning = await this.isMicroK8sRunning()
        },
      },
      {
        title: 'Start microk8s',
        skip: (ctx: any) => {
          if (ctx.isMicroK8sRunning) {
            return 'MicroK8s is already running.'
          }
        },
        task: () => {
          // microk8s.start requires sudo permissions
          // this.startMicroK8s()
          command.error('MicroK8s is not running.', { code: 'E_REQUISITE_NOT_RUNNING' })
        },
      },
      VersionHelper.getK8sCheckVersionTask(flags),
      {
        title: 'Verify if microk8s ingress and storage addons is enabled',
        task: async (ctx: any) => {
          ctx.enabledAddons = await this.enabledAddons()
        },
      },
      {
        title: 'Enable microk8s ingress addon',
        skip: (ctx: any) => {
          if (ctx.enabledAddons.ingress) {
            return 'Ingress addon is already enabled.'
          }
        },
        task: () => this.enableIngressAddon(),
      },
      {
        title: 'Enable microk8s storage addon',
        skip: (ctx: any) => {
          if (ctx.enabledAddons.storage) {
            return 'Storage addon is already enabled.'
          }
        },
        task: () => {
          // Enabling storage requires sudo permissions
          // this.enableStorageAddon()
          return command.error('The storage addon hasn\'t been enabled in microk8s', { code: 'E_REQUISITE_NOT_FOUND' })
        },
      },
      {
        title: 'Retrieving microk8s IP and domain for ingress URLs',
        enabled: () => !flags.domain,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMicroK8sIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...[${flags.domain}]`
        },
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  async isMicroK8sRunning(): Promise<boolean> {
    const { exitCode } = await execa('microk8s.status', { timeout: 10000, reject: false })
    if (exitCode === 0) {
      return true
    } else {
      return false
    }
  }

  async startMicroK8s() {
    execa('microk8s.start', { timeout: 180000 })
  }

  async enabledAddons(): Promise<object> {
    const { stdout } = await execa('microk8s.status', ['--format', 'short'], { timeout: 10000 })
    return {
      ingress: stdout.includes('ingress: enabled'),
      storage: stdout.includes('storage: enabled'),
    }
  }

  async enableIngressAddon() {
    await execa('microk8s.enable', ['ingress'], { timeout: 10000 })
  }

  async enableStorageAddon() {
    await execa('microk8s.enable', ['storage'], { timeout: 10000 })
  }

  async getMicroK8sIP(): Promise<string> {
    const { stdout } = await execa('microk8s.config', { timeout: 10000 })
    const regMatch = /server:\s*https?:\/\/([\d.]+)/.exec(stdout)
    return regMatch ? regMatch[1] : ''
  }
}
