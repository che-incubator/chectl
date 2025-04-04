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
import * as os from 'node:os'
import { ux } from '@oclif/core'
import { CheCtlContext } from '../../context'
import { DOMAIN_FLAG } from '../../flags'
import { KubeClient } from '../../api/kube-client'
import { CommonTasks } from '../common-tasks'
import { isCommandExists } from '../../utils/utls'

export namespace DockerDesktopTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    return [
      CommonTasks.getVerifyCommand('Verify if oc is installed', 'oc not found', () => isCommandExists('oc')),
      {
        title: 'Verify if kubectl context is Docker Desktop',
        task: async (_ctx: any, task: any) => {
          const kubeClient = KubeClient.getInstance()
          const context = kubeClient.getCurrentContext()
          if (context !== 'docker-for-desktop' && context !== 'docker-desktop') {
            ux.error(`E_PLATFORM_NOT_READY: current kube context is not Docker Desktop context. Found ${context}`, { exit: 1 })
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
              ux.error('E_MISSING_DOMAIN: Unable to find IPV4 ip on this computer. Needs to provide --domain flag', { exit: 1 })
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

  async function enableNginxIngress(execTimeout = 30_000): Promise<void> {
    const version = 'controller-v1.1.0'
    const genericCommand = `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/${version}/deploy/static/provider/cloud/deploy.yaml`
    await execa(genericCommand, { timeout: execTimeout, shell: true })
  }

  function grabIps(): string[] {
    const networkInterfaces = os.networkInterfaces()
    const allIps: string[] = []
    for (const interfaceName of Object.keys(networkInterfaces)) {
      // eslint-disable-next-line unicorn/no-array-for-each
      networkInterfaces[interfaceName]?.forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          allIps.push(iface.address)
        }
      })
    }

    return allIps
  }
}
