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

import { Command, Flags } from '@oclif/core'
import { ux } from '@oclif/core'
import {CheCtlContext} from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG,
  SKIP_KUBE_HEALTHZ_CHECK,
  DELETE_ALL_FLAG,
  DELETE_ALL,
  DELETE_NAMESPACE_FLAG,
  DELETE_NAMESPACE, BATCH_FLAG, BATCH, ASSUME_YES_FLAG, ASSUME_YES,
} from '../../flags'
import {
  DEFAULT_ANALYTIC_HOOK_NAME,
} from '../../constants'
import { CheTasks } from '../../tasks/che-tasks'
import {EclipseCheInstallerFactory} from '../../tasks/installers/eclipse-che/eclipse-che-installer-factory'
import {CommonTasks} from '../../tasks/common-tasks'
import {KubeConfig} from '@kubernetes/client-node'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError} from '../../utils/command-utils'
import {newListr} from '../../utils/utls'

export default class Delete extends Command {
  static description = `delete any ${EclipseChe.PRODUCT_NAME} related resource`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [DELETE_ALL_FLAG]: DELETE_ALL,
    [DELETE_NAMESPACE_FLAG]: DELETE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
    [BATCH_FLAG]: BATCH,
    [ASSUME_YES_FLAG]: ASSUME_YES,
  }

  async run() {
    const { flags } = await this.parse(Delete)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })

    const tasks = newListr()
    tasks.add(CommonTasks.getTestKubernetesApiTasks())
    tasks.add(CommonTasks.getOpenShiftVersionTask())
    tasks.add(EclipseCheInstallerFactory.getInstaller().getDeleteTasks())
    tasks.add(CheTasks.getWaitPodsDeletedTasks())

    if (flags[DELETE_NAMESPACE_FLAG]) {
      tasks.add(CommonTasks.getDeleteNamespaceTask(flags[CHE_NAMESPACE_FLAG]!))
    }

    if (await this.isDeletionConfirmed(flags)) {
      try {
        await tasks.run(ctx)
        ux.log(getCommandSuccessMessage())
      } catch (err: any) {
        this.error(wrapCommandError(err))
      }
    } else {
      this.exit(0)
    }

    if (!flags[BATCH_FLAG]) {
      notifyCommandCompletedSuccessfully()
    }

    this.exit(0)
  }

  async isDeletionConfirmed(flags: any): Promise<boolean> {
    const kubeConfig = new KubeConfig()
    kubeConfig.loadFromDefault()

    const cluster = kubeConfig.getCurrentCluster()
    if (!cluster) {
      throw new Error('Failed to get current Kubernetes cluster. Check if the current context is set via kubectl/oc')
    }

    if (!flags[BATCH_FLAG] && !flags[ASSUME_YES_FLAG]) {
      return ux.confirm(`You're going to remove ${EclipseChe.PRODUCT_NAME} server in namespace '${flags[CHE_NAMESPACE_FLAG]}' on server '${cluster ? cluster.server : ''}'. If you want to continue - press Y`)
    }

    return true
  }
}
