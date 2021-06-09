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

import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'

import { CommonPlatformTasks } from './common-platform-tasks'

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
        task: () => this.enableIngressAddon(),
      },
      {
        title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => !flags.domain,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMinikubeIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...${flags.domain}.`
        },
      },
      {
        title: 'Checking minikube version',
        task: async (ctx: any, task: any) => {
          const version = await this.getMinikbeVersion()
          const versionComponents = version.split('.')
          ctx.minikubeVersionMajor = parseInt(versionComponents[0], 10)
          ctx.minikubeVersionMinor = parseInt(versionComponents[1], 10)
          ctx.minikubeVersionPatch = parseInt(versionComponents[2], 10)

          task.title = `${task.title}... ${version}`
        },
      },
      {
        // Starting from Minikube 1.9 there is a bug with storage provisioner which prevents Che from successful deployment.
        // For more details see https://github.com/kubernetes/minikube/issues/7218
        // To workaround the bug, it is required to patch storage provisioner as well as its permissions.
        title: 'Patch minikube storage',
        enabled: ctx => ctx.minikubeVersionMajor && ctx.minikubeVersionMinor && ctx.minikubeVersionMajor === 1 &&
          ((ctx.minikubeVersionMinor >= 9 && ctx.minikubeVersionMinor <= 11) || (ctx.minikubeVersionMinor === 12 && ctx.minikubeVersionPatch <= 1)),
        task: async (_ctx: any, task: any) => {
          // Patch storage provisioner pod to the latest version
          const storageProvisionerImage = 'gcr.io/k8s-minikube/storage-provisioner@sha256:bb22ad560924f0f111eb30ffc2dc1315736ab09979c5e77ff9d7d3737f671ca0'
          const storageProvisionerImagePatch = {
            apiVersion: 'v1',
            kind: 'Pod',
            spec: {
              containers: [
                { name: 'storage-provisioner', image: storageProvisionerImage },
              ],
            },
          }
          if (!await kube.patchNamespacedPod('storage-provisioner', 'kube-system', storageProvisionerImagePatch)) {
            throw new Error('Failed to patch storage provisioner image')
          }

          // Set required permissions for cluster role of persistent volume provisioner
          if (!await kube.addClusterRoleRule('system:persistent-volume-provisioner',
            [''], ['endpoints'], ['get', 'list', 'watch', 'create', 'patch', 'update'])) {
            throw new Error('Failed to patch permissions for persistent-volume-provisioner')
          }

          task.title = `${task.title}... done`
        },
      },
      CommonPlatformTasks.getPingClusterTask(flags),
    ], { renderer: flags['listr-renderer'] as any })
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

  async enableIngressAddon() {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 60000 })
  }

  async getMinikubeIP(): Promise<string> {
    const { stdout } = await execa('minikube', ['ip'], { timeout: 10000 })
    return stdout
  }

  async getMinikbeVersion(): Promise<string> {
    const { stdout } = await execa('minikube', ['version'], { timeout: 10000 })
    const versionLine = stdout.split('\n')[0]
    const versionString = versionLine.trim().split(' ')[2].substr(1)
    return versionString
  }
}
