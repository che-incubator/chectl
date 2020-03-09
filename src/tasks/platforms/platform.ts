/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import Command from '@oclif/command'
import * as Listr from 'listr'

import { CRCHelper } from './crc'
import { DockerDesktopTasks } from './docker-desktop'
import { K8sTasks } from './k8s'
import { MicroK8sTasks } from './microk8s'
import { MinikubeTasks } from './minikube'
import { MinishiftTasks } from './minishift'
import { OpenshiftTasks } from './openshift'

/**
 * Platform specific tasks.
 *  - preflightCheck
 */
export class PlatformTasks {
  preflightCheckTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const minikubeTasks = new MinikubeTasks()
    const microk8sTasks = new MicroK8sTasks()
    const minishiftTasks = new MinishiftTasks()
    const openshiftTasks = new OpenshiftTasks()
    const k8sTasks = new K8sTasks()
    const crc = new CRCHelper()
    const dockerDesktopTasks = new DockerDesktopTasks(flags)

    let task: Listr.ListrTask
    if (!flags.platform) {
      task = {
        title: '✈️  Platform preflight checklist',
        task: () => { command.error('Platform is required ¯\\_(ツ)_/¯') }
      }
    } else if (flags.platform === 'openshift') {
      task = {
        title: '✈️  Openshift preflight checklist',
        task: () => openshiftTasks.preflightCheckTasks(flags, command)
      }
    } else if (flags.platform === 'crc') {
      task = {
        title: '✈️  CodeReady Containers preflight checklist',
        task: () => crc.preflightCheckTasks(flags, command)
      }
    /* platform.ts BEGIN CHE ONLY */
    } else if (flags.platform === 'minikube') {
      task = {
        title: '✈️  Minikube preflight checklist',
        task: () => minikubeTasks.preflightCheckTasks(flags, command)
      }
    } else if (flags.platform === 'minishift') {
      task = {
        title: '✈️  Minishift preflight checklist',
        task: () => minishiftTasks.preflightCheckTasks(flags, command)
      }
    } else if (flags.platform === 'microk8s') {
      task = {
        title: '✈️  MicroK8s preflight checklist',
        task: () => microk8sTasks.preflightCheckTasks(flags, command)
      }
    } else if (flags.platform === 'k8s') {
      task = {
        title: '✈️  Kubernetes preflight checklist',
        task: () => k8sTasks.preflightCheckTasks(flags, command)
      }
    } else if (flags.platform === 'docker-desktop') {
      task = {
        title: '✈️  Docker Desktop preflight checklist',
        task: () => dockerDesktopTasks.preflightCheckTasks(flags, command)
      }
    /* platform.ts END CHE ONLY */
    } else {
      task = {
        title: '✈️  Platform preflight checklist',
        task: () => { command.error(`Platform ${flags.platform} is not supported yet ¯\\_(ツ)_/¯`) }
      }
    }

    return [task]
  }
}
