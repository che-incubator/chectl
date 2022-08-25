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
import { OIDCContextKeys } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { sleep } from '../../util'

export class MinikubeTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  preflightCheckTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
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
        title: 'Verify if minikube is installed',
        task: () => {
          if (!commandExists.sync('minikube')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          }
        },
      },
      {
        title: 'Verify if minikube is running',
        task: async (ctx: any) => {
          ctx.isMinikubeRunning = await this.isMinikubeRunning()
        },
      },
      {
        title: 'Start minikube',
        skip: (ctx: any) => {
          if (ctx.isMinikubeRunning) {
            return 'Minikube is already running.'
          }
        },
        task: () => this.startMinikube(),
      },
      VersionHelper.getK8sCheckVersionTask(flags),
      {
        title: 'Verify if minikube ingress addon is enabled',
        task: async (ctx: any) => {
          ctx.isIngressAddonEnabled = await this.isIngressAddonEnabled()
        },
      },
      {
        title: 'Enable minikube ingress addon',
        skip: (ctx: any) => {
          if (ctx.isIngressAddonEnabled) {
            return 'Ingress addon is already enabled.'
          }
        },
        task: async () => {
          await this.enableIngressAddon()
          await kube.waitForPodReady('app.kubernetes.io/instance=ingress-nginx,app.kubernetes.io/component=controller', 'ingress-nginx')
        },
      },
      {
        title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => !flags.domain,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMinikubeIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...[${flags.domain}]`
        },
      },
      {
        title: 'Checking minikube version',
        task: async (ctx: any, task: any) => {
          const version = await this.getMinikubeVersion()
          const versionComponents = version.split('.')
          ctx.minikubeVersionMajor = parseInt(versionComponents[0], 10)
          ctx.minikubeVersionMinor = parseInt(versionComponents[1], 10)
          ctx.minikubeVersionPatch = parseInt(versionComponents[2], 10)

          task.title = `${task.title}...[${version}]`
        },
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  configureApiServerForDex(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Create /etc/ca-certificates directory',
        enabled: (ctx: any) => Boolean(ctx[OIDCContextKeys.CA_FILE]),
        task: async (_ctx: any, task: any) => {
          const args: string[] = []
          args.push('ssh')
          args.push('sudo mkdir -p /etc/ca-certificates')

          await execa('minikube', args, { timeout: 60000 })

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Copy Dex certificate into Minikube',
        enabled: (ctx: any) => Boolean(ctx[OIDCContextKeys.CA_FILE]),
        task: async (ctx: any, task: any) => {
          const args: string[] = []
          args.push('cp')
          args.push(ctx[OIDCContextKeys.CA_FILE])
          args.push('/etc/ca-certificates/dex-ca.crt')

          await execa('minikube', args, { timeout: 60000 })

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Configure Minikube API server',
        task: async (ctx: any, task: any) => {
          const args: string[] = []
          args.push(`--extra-config=apiserver.oidc-issuer-url=${ctx[OIDCContextKeys.ISSUER_URL]}`)
          args.push(`--extra-config=apiserver.oidc-client-id=${ctx[OIDCContextKeys.CLIENT_ID]}`)

          if (ctx[OIDCContextKeys.CA_FILE]) {
            args.push('--extra-config=apiserver.oidc-ca-file=/etc/ca-certificates/dex-ca.crt')
          }

          args.push('--extra-config=apiserver.oidc-username-claim=name')
          args.push('--extra-config=apiserver.oidc-username-prefix=-')
          args.push('--extra-config=apiserver.oidc-groups-claim=groups')
          args.push('start')

          await execa('minikube', args, { timeout: 180000 })

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait for Minikube API server',
        task: async (_ctx: any, task: any) => {
          await sleep(30 * 1000)

          const kube = new KubeHelper(flags)
          await kube.waitForPodReady('component=kube-apiserver', 'kube-system')

          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  async isMinikubeRunning(): Promise<boolean> {
    const { exitCode } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (exitCode === 0) {
      return true
    } else {
      return false
    }
  }

  async startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: 180000 })
  }

  async isIngressAddonEnabled(): Promise<boolean> {
    // try with json output (recent minikube version)
    const { stdout, exitCode } = await execa('minikube', ['addons', 'list', '-o', 'json'], { timeout: 10000, reject: false })
    if (exitCode === 0) {
      // grab json
      const json = JSON.parse(stdout)
      return json.ingress && json.ingress.Status === 'enabled'
    } else {
      // probably with old minikube, let's try with classic output
      const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 10000 })
      return stdout.includes('ingress: enabled')
    }
  }

  async enableIngressAddon(): Promise<void> {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 60000 })
  }

  async getMinikubeIP(): Promise<string> {
    const { stdout } = await execa('minikube', ['ip'], { timeout: 10000 })
    return stdout
  }

  async getMinikubeVersion(): Promise<string> {
    const { stdout } = await execa('minikube', ['version'], { timeout: 10000 })
    const versionLine = stdout.split('\n')[0]
    const versionString = versionLine.trim().split(' ')[2].substr(1)
    return versionString
  }
}

