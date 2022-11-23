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

import { Command, flags } from '@oclif/command'
import { cli } from 'cli-ux'

import {CheCtlContext} from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG,
  SKIP_KUBE_HEALTHZ_CHECK, BATCH_FLAG,
} from '../../flags'
import { CheTasks } from '../../tasks/che-tasks'
import {KubeClient} from '../../api/kube-client'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {CommonTasks} from '../../tasks/common-tasks'
import {DEFAULT_ANALYTIC_HOOK_NAME} from '../../constants'
import {getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError} from '../../utils/command-utils'
import {newListr} from '../../utils/utls'

export default class Stop extends Command {
  static description = `stop ${EclipseChe.PRODUCT_NAME} server`

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
  }

  async run() {
    const { flags } = this.parse(Stop)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    const kubeHelper = KubeClient.getInstance()
    flags[CHE_NAMESPACE_FLAG] = flags[CHE_NAMESPACE_FLAG] || await kubeHelper.findCheClusterNamespace() || EclipseChe.NAMESPACE

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Stop.id, flags })

    const tasks = newListr()
    tasks.add(CommonTasks.getTestKubernetesApiTasks())
    tasks.add(CheTasks.getScaleCheDownTasks())
    tasks.add(CheTasks.getWaitPodsDeletedTasks())

    try {
      await tasks.run(ctx)
      cli.log(getCommandSuccessMessage())
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    if (!flags[BATCH_FLAG]) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }
}
