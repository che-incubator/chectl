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

import * as execa from 'execa'
import * as Listr from 'listr'

import { CheCtlContext } from '../../context'
import { DOMAIN_FLAG } from '../../flags'
import { CommonTasks } from '../common-tasks'
import { isCommandExists } from '../../utils/utls'

export namespace MicroK8sTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  export function getPeflightCheckTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()
    return [
      CommonTasks.getVerifyCommand('Verify if kubectl is installed', 'kubectl not found', () => isCommandExists('kubectl')),
      CommonTasks.getVerifyCommand('Verify if microk8s is installed', 'MicroK8s not found', () => isCommandExists('microk8s.status')),
      CommonTasks.getVerifyCommand('Verify if microk8s is running', 'MicroK8s is not running.', () => isMicroK8sRunning()),
      {
        title: 'Verify if microk8s ingress addon is enabled',
        task: async (_ctx: any, task: any) => {
          const enabledAddons = await getEnabledAddons()
          if (!enabledAddons.ingress) {
            await enableIngressAddon()
          }

          task.title = `${task.title}...[Enabled]`
        },
      },
      {
        title: 'Verify if microk8s storage addon is enabled',
        task: async (_ctx: any, task: any) => {
          const enabledAddons = await getEnabledAddons()
          if (!enabledAddons.storage) {
            await enableStorageAddon()
          }

          task.title = `${task.title}...[Enabled]`
        },
      },
      {
        title: 'Retrieving microk8s IP and domain for ingress URLs',
        enabled: () => !flags[DOMAIN_FLAG],
        task: async (_ctx: any, task: any) => {
          const ip = await getMicroK8sIP()
          flags[DOMAIN_FLAG] = ip + '.nip.io'
          task.title = `${task.title}...[${flags[DOMAIN_FLAG]}]`
        },
      },
    ]
  }

  async function isMicroK8sRunning(): Promise<boolean> {
    const { exitCode } = await execa('microk8s.status', { timeout: 10_000, reject: false })
    return exitCode === 0
  }

  async function getEnabledAddons(): Promise<any> {
    const { stdout } = await execa('microk8s.status', ['--format', 'short'], { timeout: 10_000 })
    return {
      ingress: stdout.includes('ingress: enabled'),
      storage: stdout.includes('storage: enabled'),
    }
  }

  async function enableIngressAddon() {
    await execa('microk8s.enable', ['ingress'], { timeout: 10_000 })
  }

  async function enableStorageAddon() {
    await execa('microk8s.enable', ['storage'], { timeout: 10_000 })
  }

  async function getMicroK8sIP(): Promise<string> {
    const { stdout } = await execa('microk8s.config', { timeout: 10_000 })
    const regMatch = /server:\s*https?:\/\/([\d.]+)/.exec(stdout)
    return regMatch ? regMatch[1] : ''
  }
}
