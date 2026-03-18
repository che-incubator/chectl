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

import { CheCtlContext } from '../../context'
import {
  K8S_POD_READY_TIMEOUT_FLAG,
  LOG_DIRECTORY_FLAG,
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG,
  SKIP_KUBE_HEALTHZ_CHECK,
  BATCH_FLAG,
  BATCH,
  LOG_DIRECTORY,
  K8S_POD_WAIT_TIMEOUT_FLAG,
  K8S_POD_WAIT_TIMEOUT,
  K8S_POD_READY_TIMEOUT,
  K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG,
  K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
  K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG, K8S_POD_ERROR_RECHECK_TIMEOUT,
} from '../../flags'
import { EclipseChe } from '../../tasks/installers/eclipse-che/eclipse-che'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CommonTasks } from '../../tasks/common-tasks'
import { CheTasks } from '../../tasks/che-tasks'
import { getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../utils/command-utils'
import { newListr } from '../../utils/utls'

export default class Start extends Command {
  static description = `Start ${EclipseChe.PRODUCT_NAME} server`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
    [BATCH_FLAG]: BATCH,
    [K8S_POD_WAIT_TIMEOUT_FLAG]: K8S_POD_WAIT_TIMEOUT,
    [K8S_POD_READY_TIMEOUT_FLAG]: K8S_POD_READY_TIMEOUT,
    [K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG]: K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
    [K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG]: K8S_POD_ERROR_RECHECK_TIMEOUT,
    [LOG_DIRECTORY_FLAG]: LOG_DIRECTORY,
  }

  async run() {
    const { flags } = await this.parse(Start)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Start.id, flags })

    const tasks = newListr()
    tasks.add(CommonTasks.getTestKubernetesApiTasks())
    tasks.add(CheTasks.getServerLogsTasks(true))
    tasks.add(CheTasks.getScaleCheUpTasks())

    try {
      await tasks.run(ctx)
      ux.log(getCommandSuccessMessage())
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    if (!flags[BATCH_FLAG]) {
      notifyCommandCompletedSuccessfully()
    }

    this.exit(0)
  }
}
