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

import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'
import * as os from 'os'
import {cli} from 'cli-ux'
import {CheCtlContext} from '../../context'
import {DOMAIN_FLAG} from '../../flags'
import {KubeClient} from '../../api/kube-client'
import {CommonTasks} from '../common-tasks'

export namespace DockerDesktopTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    return [
      CommonTasks.getVerifyCommand('Verify if oc is installed', 'oc not found',  () => commandExists.sync('oc')),
      {
        title: 'Verify if kubectl context is Docker Desktop',
        task: async (_ctx: any, task: any) => {
          const kubeClient = KubeClient.getInstance()
          const context = await kubeClient.currentContext()
          if (context !== 'docker-for-desktop' && context !== 'docker-desktop') {
            cli.error(`E_PLATFORM_NOT_READY: current kube context is not Docker Desktop context. Found ${context}`)
          } else {
            task.title = `${task.title}: [Found ${context}]`
          }
        },
      },
      {
        title: 'Verify if nginx ingress is installed',
        task: async (ctx: any) => {
          ctx.isNginxIngressInstalled = await isNginxIngressEnabled()
        },
      },
      {
        title: 'Installing nginx ingress',
        skip: (ctx: any) => {
          if (ctx.isNginxIngressInstalled) {
            return 'Ngninx ingress is already setup.'
          }
        },
        task: () => enableNginxIngress(),
      },
      {
        title: 'Verify domain is set',
        task: async (_ctx: any, task: any) => {
          const flags = CheCtlContext.getFlags()
          if (!flags[DOMAIN_FLAG]) {
            const ips = grabIps()
            if (ips.length === 0) {
              cli.error('E_MISSING_DOMAIN: Unable to find IPV4 ip on this computer. Needs to provide --domain flag')
            } else if (ips.length >= 1) {
              flags[DOMAIN_FLAG] = `${ips[0]}.nip.io`
            }
            task.title = `${task.title}...[Auto-assigning domain to ${flags[DOMAIN_FLAG]}]`
          }
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  // $ kubectl get services --namespace ingress-nginx
  async function isNginxIngressEnabled(): Promise<boolean> {
    const kubeClient = KubeClient.getInstance()
    const services = await kubeClient.getServicesBySelector('', 'ingress-nginx')
    return services.items.length > 0
  }

  async function enableNginxIngress(execTimeout = 30000): Promise<void> {
    const version = 'controller-v1.1.0'
    const genericCommand = `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/${version}/deploy/static/provider/cloud/deploy.yaml`
    await execa(genericCommand, { timeout: execTimeout, shell: true })
  }

  function grabIps(): string[] {
    const networkInterfaces = os.networkInterfaces()
    const allIps: string[] = []
    Object.keys(networkInterfaces).forEach(interfaceName => {
      networkInterfaces[interfaceName]?.forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          allIps.push(iface.address)
        }
      })
    })
    return allIps
  }
}
