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

import {CheCtlContext, CliContext} from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG, SKIP_KUBE_HEALTHZ_CHECK, LOG_DIRECTORY_FLAG, LOG_DIRECTORY,
} from '../../flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che-tasks'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {CommonTasks} from '../../tasks/common-tasks'
import {getCommandSuccessMessage, wrapCommandError} from '../../utils/command-utils'
import {newListr} from '../../utils/utls'

export default class Logs extends Command {
  static description = `Collect ${EclipseChe.PRODUCT_NAME} logs`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [LOG_DIRECTORY_FLAG]: LOG_DIRECTORY,
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
  }

  async run() {
    const { flags } = await this.parse(Logs)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Logs.id, flags })

    const tasks = newListr()
    tasks.add(CommonTasks.getTestKubernetesApiTasks())
    tasks.add(CheTasks.getServerLogsTasks(false))

    try {
      this.log(`${EclipseChe.PRODUCT_NAME} logs will be available in '${ctx[CliContext.CLI_COMMAND_LOGS_DIR]}'`)
      await tasks.run(ctx)
      this.log(getCommandSuccessMessage())
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    this.exit(0)
  }
}
