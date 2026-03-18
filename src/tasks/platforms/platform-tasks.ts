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

import { ux } from '@oclif/core'
import * as Listr from 'listr'
import { CRCTasks } from './crc'
import { DockerDesktopTasks } from './docker-desktop'
import { K8sTasks } from './k8s'
import { MicroK8sTasks } from './microk8s'
import { MinikubeTasks } from './minikube'
import { OpenshiftTasks } from './openshift'
import { CheCtlContext } from '../../context'
import { PLATFORM_FLAG } from '../../flags'
import { newListr } from '../../utils/utls'

/**
 * Platform specific tasks.
 */
export namespace PlatformTasks {
  export function getPreflightCheckTasks(): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()

    if (!flags[PLATFORM_FLAG]) {
      return {
        title: 'Platform preflight checklist',
        task: () => {
          ux.error('Platform is required', { exit: 1 })
        },
      }
    } else if (flags[PLATFORM_FLAG] === 'openshift') {
      return {
        title: 'Openshift preflight checklist',
        task: (_ctx: any) => newListr(OpenshiftTasks.getPreflightCheckTasks()),
      }
    } else if (flags[PLATFORM_FLAG] === 'crc') {
      return {
        title: 'OpenShift Local preflight checklist',
        task: () => newListr(CRCTasks.getPreflightCheckTasks()),
      }
      // platform-factory.ts BEGIN CHE ONLY
    } else if (flags[PLATFORM_FLAG] === 'minikube') {
      return {
        title: 'Minikube preflight checklist',
        task: () => newListr(MinikubeTasks.getPreflightCheckTasks()),
      }
    } else if (flags[PLATFORM_FLAG] === 'microk8s') {
      return {
        title: 'MicroK8s preflight checklist',
        task: () => newListr(MicroK8sTasks.getPeflightCheckTasks()),
      }
    } else if (flags[PLATFORM_FLAG] === 'k8s') {
      return {
        title: 'Kubernetes preflight checklist',
        task: () => newListr(K8sTasks.getPeflightCheckTasks()),
      }
    } else if (flags[PLATFORM_FLAG] === 'docker-desktop') {
      return {
        title: 'Docker Desktop preflight checklist',
        task: () => newListr(DockerDesktopTasks.getPreflightCheckTasks()),
      }
      // platform-factory.ts END CHE ONLY
    } else {
      return {
        title: 'Platform preflight checklist',
        task: () => {
          ux.error(`Platform ${flags[PLATFORM_FLAG]} is not supported yet ¯\\_(ツ)_/¯`, { exit: 1 })
        },
      }
    }
  }

  export function getConfigureApiServerForDexTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()
    if (flags[PLATFORM_FLAG] === 'minikube') {
      return MinikubeTasks.configureApiServerForDex()
    } else {
      ux.error(`It is not possible to configure API server for ${flags[PLATFORM_FLAG]}.`, { exit: 1 })
    }
  }
}
