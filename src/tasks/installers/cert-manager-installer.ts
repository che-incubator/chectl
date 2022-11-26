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

import * as Listr from 'listr'
import { KubeClient } from '../../api/kube-client'
import {Installer} from './installer'
import {CheCtlContext} from '../../context'
import {SKIP_CERT_MANAGER_FLAG} from '../../flags'
import {CommonTasks} from '../common-tasks'
import {newListr} from '../../utils/utls'

export namespace CertManager {
  export const NAMESPACE = 'cert-manager'
  export const VERSION = 'v1.8.2'

  export function getApplyResourcesTask(): Listr.ListrTask<any> {
    return {
      title: 'Apply resources',
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        const certManagerCrd = await kubeHelper.getCustomResourceDefinition('certificates.cert-manager.io')
        if (certManagerCrd) {
          task.title = `${task.title}...[Exists]`
        } else {
          await kubeHelper.applyResource(`https://github.com/cert-manager/cert-manager/releases/download/${VERSION}/cert-manager.yaml`)
          task.title = `${task.title}...[Created]`
        }
      },
    }
  }

  export function getWaitCertManagerTask(): Listr.ListrTask<any> {
    return {
      title: 'Wait for Cert Manager pods ready',
      task: async (ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        await kubeHelper.waitForPodReady('app.kubernetes.io/name=cert-manager', NAMESPACE)
        await kubeHelper.waitForPodReady('app.kubernetes.io/name=webhook', NAMESPACE)
        await kubeHelper.waitForPodReady('app.kubernetes.io/name=cainjector', NAMESPACE)
        task.title = `${task.title}...[OK]`
      },
    }
  }
}

export class CertManagerInstaller implements Installer {
  protected skip: boolean

  constructor() {
    const flags = CheCtlContext.getFlags()
    this.skip = flags[SKIP_CERT_MANAGER_FLAG]
  }

  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Install Cert Manager ${CertManager.VERSION}`,
      skip: () => this.skip,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(CertManager.getApplyResourcesTask())
        tasks.add(CertManager.getWaitCertManagerTask())
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }
}
