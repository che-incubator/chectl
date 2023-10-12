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
import {CheCtlContext, OIDCContext} from '../../context'
import { KubeClient } from '../../api/kube-client'
import {isCommandExists, sleep} from '../../utils/utls'
import {DOMAIN_FLAG} from '../../flags'
import {CommonTasks} from '../common-tasks'

export namespace MinikubeTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()
    return [
      CommonTasks.getVerifyCommand('Verify if kubectl is installed', 'kubectl not found', () => isCommandExists('kubectl')),
      CommonTasks.getVerifyCommand('Verify if minikube is installed', 'minikube not found', () => isCommandExists('minikube')),
      {
        title: 'Verify if minikube is running',
        task: async (_ctx: any, task: any) => {
          const isRunning = await isMinikubeRunning()
          if (!isRunning) {
            await startMinikube()
          }

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Enable minikube ingress addon',
        task: async (_ctx: any, task: any) => {
          const enabled = await isIngressAddonEnabled()
          if (!enabled) {
            await enableIngressAddon()
            const kubeClient = KubeClient.getInstance()
            await kubeClient.waitForPodReady('app.kubernetes.io/instance=ingress-nginx,app.kubernetes.io/component=controller', 'ingress-nginx')
          }

          task.title = `${task.title}...[Enabled]`
        },
      },
      {
        title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => !flags[DOMAIN_FLAG],
        task: async (_ctx: any, task: any) => {
          const ip = await getMinikubeIP()
          flags[DOMAIN_FLAG] = ip + '.nip.io'
          task.title = `${task.title}...[${flags[DOMAIN_FLAG]}]`
        },
      },
      {
        title: 'Checking minikube version',
        task: async (ctx: any, task: any) => {
          const version = await getMinikubeVersion()
          const versionComponents = version.split('.')
          ctx.minikubeVersionMajor = Number.parseInt(versionComponents[0], 10)
          ctx.minikubeVersionMinor = Number.parseInt(versionComponents[1], 10)
          ctx.minikubeVersionPatch = Number.parseInt(versionComponents[2], 10)

          task.title = `${task.title}...[${version}]`
        },
      },
    ]
  }

  export function configureApiServerForDex(): Listr.ListrTask<any>[] {
    return [
      {
        title: 'Create /etc/ca-certificates directory',
        enabled: (ctx: any) => Boolean(ctx[OIDCContext.CA_FILE]),
        task: async (_ctx: any, task: any) => {
          const args: string[] = []
          args.push('ssh', 'sudo mkdir -p /etc/ca-certificates')

          await execa('minikube', args, { timeout: 60_000 })

          task.title = `${task.title}...[Created]`
        },
      },
      {
        title: 'Copy Dex certificate into Minikube',
        enabled: (ctx: any) => Boolean(ctx[OIDCContext.CA_FILE]),
        task: async (ctx: any, task: any) => {
          const args: string[] = []
          args.push('cp', ctx[OIDCContext.CA_FILE], '/etc/ca-certificates/dex-ca.crt')

          await execa('minikube', args, { timeout: 60_000 })

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Configure Minikube API server',
        task: async (ctx: any, task: any) => {
          const args: string[] = []
          args.push(`--extra-config=apiserver.oidc-issuer-url=${ctx[OIDCContext.ISSUER_URL]}`, `--extra-config=apiserver.oidc-client-id=${ctx[OIDCContext.CLIENT_ID]}`)

          if (ctx[OIDCContext.CA_FILE]) {
            args.push('--extra-config=apiserver.oidc-ca-file=/etc/ca-certificates/dex-ca.crt')
          }

          args.push('--extra-config=apiserver.oidc-username-claim=name', '--extra-config=apiserver.oidc-username-prefix=-', '--extra-config=apiserver.oidc-groups-claim=groups', 'start')

          await execa('minikube', args, { timeout: 180_000 })

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait for Minikube API server',
        task: async (_ctx: any, task: any) => {
          await sleep(30 * 1000)

          const kubeClient = KubeClient.getInstance()
          await kubeClient.waitForPodReady('component=kube-apiserver', 'kube-system')

          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  async function isMinikubeRunning(): Promise<boolean> {
    const {exitCode} = await execa('minikube', ['status'], {timeout: 10_000, reject: false})
    return exitCode === 0
  }

  async function startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: 180_000 })
  }

  async function isIngressAddonEnabled(): Promise<boolean> {
    // try with json output (recent minikube version)
    const { stdout, exitCode } = await execa('minikube', ['addons', 'list', '-o', 'json'], { timeout: 10_000, reject: false })
    if (exitCode === 0) {
      // grab json
      const json = JSON.parse(stdout)
      return json.ingress && json.ingress.Status === 'enabled'
    } else {
      // probably with old minikube, let's try with classic output
      const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 10_000 })
      return stdout.includes('ingress: enabled')
    }
  }

  async function enableIngressAddon(): Promise<void> {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 60_000 })
  }

  async function getMinikubeIP(): Promise<string> {
    const { stdout } = await execa('minikube', ['ip'], { timeout: 10_000 })
    return stdout
  }

  async function getMinikubeVersion(): Promise<string> {
    const { stdout } = await execa('minikube', ['version'], { timeout: 10_000 })
    const versionLine = stdout.split('\n')[0]
    const versionString = versionLine.trim().split(' ')[2].slice(1)
    return versionString
  }
}

