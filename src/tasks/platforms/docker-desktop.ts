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
import * as os from 'os'

import { KubeHelper } from '../../api/kube'

export class DockerDesktopTasks {
  private readonly kh: KubeHelper

  constructor(flags: any) {
    this.kh = new KubeHelper(flags)
  }

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
        title: 'Verify if kubectl context is Docker Desktop',
        task: async (_ctx: any, task: any) => {
          const context = await this.kh.currentContext()
          if (context !== 'docker-for-desktop') {
            command.error(`E_PLATFORM_NOT_READY: current kube context is not Docker Desktop context. Found ${context}`)
          } else {
            task.title = `${task.title}: Found ${context}.`
          }
        }
      },
      {
        title: 'Verify remote kubernetes status',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kh.checkKubeApi()
            task.title = `${task.title}...done.`
          } catch (error) {
            command.error('E_PLATFORM_NOT_READY: ' + error)
          }
        }
      },
      {
        title: 'Verify if nginx ingress is installed',
        task: async (ctx: any) => {
          ctx.isNginxIngressInstalled = await this.isNginxIngressEnabled()
        }
      },
      {
        title: 'Installing nginx ingress',
        skip: (ctx: any) => {
          if (ctx.isNginxIngressInstalled) {
            return 'Ngninx ingress is already setup.'
          }
        },
        task: () => this.enableNginxIngress()
      },

      // Should automatically compute route if missing
      {
        title: 'Verify domain is set',
        task: async (_ctx: any, task: any) => {
          if (flags.domain === undefined || flags.domain === '') {
            const ips = this.grabIps()
            if (ips.length === 0) {
              command.error('E_MISSING_DOMAIN: Unable to find IPV4 ip on this computer. Needs to provide --domain flag')
            } else if (ips.length >= 1) {
              flags.domain = `${ips[0]}.nip.io`
            }
            task.title = `${task.title}... auto-assigning domain to ${flags.domain}.`
          }
          task.title = `${task.title}...set to ${flags.domain}.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  // $ kubectl get services --namespace ingress-nginx
  async isNginxIngressEnabled(): Promise<boolean> {
    const services = await this.kh.getServicesBySelector('', 'ingress-nginx')
    return services.items.length > 0
  }

  async enableNginxIngress(execTimeout = 30000): Promise<void> {
    const sha1 = '78d6ce6e6e7d77309bc1e8a563e4ee5308db5566'

    // mandatory part
    const mandatoryCommand = `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/${sha1}/deploy/static/mandatory.yaml`
    await execa(mandatoryCommand, { timeout: execTimeout, shell: true })

    // mandatory part
    const genericCommand = `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/${sha1}/deploy/static/provider/cloud-generic.yaml`
    await execa(genericCommand, { timeout: execTimeout, shell: true })
  }

  grabIps(): string[] {
    let networkInterfaces = os.networkInterfaces()
    const allIps: string[] = []
    Object.keys(networkInterfaces).forEach(interfaceName => {
      networkInterfaces[interfaceName].forEach(iface => {
        if (iface.family === 'IPv4' && iface.internal !== true) {
          allIps.push(iface.address)
        }
      })
    })
    return allIps
  }

}
