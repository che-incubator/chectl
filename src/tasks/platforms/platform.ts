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

import Command from '@oclif/command'
import { cli } from 'cli-ux'
import * as Listr from 'listr'
import { CRCHelper } from './crc'
import { DockerDesktopTasks } from './docker-desktop'
import { K8sTasks } from './k8s'
import { MicroK8sTasks } from './microk8s'
import { MinikubeTasks } from './minikube'
import { OpenshiftTasks } from './openshift'

/**
 * Platform specific tasks.
 */
export class PlatformTasks {
  protected minikubeTasks: MinikubeTasks
  protected microk8sTasks: MicroK8sTasks
  protected openshiftTasks: OpenshiftTasks
  protected k8sTasks: K8sTasks
  protected crc: CRCHelper
  protected dockerDesktopTasks: DockerDesktopTasks

  constructor(flags: any) {
    this.minikubeTasks = new MinikubeTasks()
    this.microk8sTasks = new MicroK8sTasks()
    this.openshiftTasks = new OpenshiftTasks()
    this.k8sTasks = new K8sTasks()
    this.crc = new CRCHelper()
    this.dockerDesktopTasks = new DockerDesktopTasks(flags)
  }

  preflightCheckTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    let task: Listr.ListrTask
    if (!flags.platform) {
      task = {
        title: '✈️  Platform preflight checklist',
        task: () => {
          command.error('Platform is required ¯\\_(ツ)_/¯')
        },
      }
    } else if (flags.platform === 'openshift') {
      task = {
        title: '✈️  Openshift preflight checklist',
        task: () => this.openshiftTasks.preflightCheckTasks(flags, command),
      }
    } else if (flags.platform === 'crc') {
      task = {
        title: '✈️  CodeReady Containers preflight checklist',
        task: () => this.crc.preflightCheckTasks(flags, command),
      }
      // platform.ts BEGIN CHE ONLY
    } else if (flags.platform === 'minikube') {
      task = {
        title: '✈️  Minikube preflight checklist',
        task: () => this.minikubeTasks.preflightCheckTasks(flags, command),
      }
    } else if (flags.platform === 'microk8s') {
      task = {
        title: '✈️  MicroK8s preflight checklist',
        task: () => this.microk8sTasks.preflightCheckTasks(flags, command),
      }
    } else if (flags.platform === 'k8s') {
      task = {
        title: '✈️  Kubernetes preflight checklist',
        task: () => this.k8sTasks.preflightCheckTasks(flags, command),
      }
    } else if (flags.platform === 'docker-desktop') {
      task = {
        title: '✈️  Docker Desktop preflight checklist',
        task: () => this.dockerDesktopTasks.preflightCheckTasks(flags, command),
      }
      // platform.ts END CHE ONLY
    } else {
      task = {
        title: '✈️  Platform preflight checklist',
        task: () => {
          command.error(`Platform ${flags.platform} is not supported yet ¯\\_(ツ)_/¯`)
        },
      }
    }

    return [task]
  }

  configureApiServerForDex(flags: any): ReadonlyArray<Listr.ListrTask> {
    if (flags.platform === 'minikube') {
      return this.minikubeTasks.configureApiServerForDex(flags)
    } else {
      cli.error(`It is not possible to configure API server for ${flags.platform}.`)
    }
  }
}
