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

import {CheCtlContext} from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  DEBUG_PORT_FLAG,
  DEBUG_PORT,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG, SKIP_KUBE_HEALTHZ_CHECK,
} from '../../flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che-tasks'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {CommonTasks} from '../../tasks/common-tasks'
import {wrapCommandError} from '../../utils/command-utils'
import {newListr} from '../../utils/utls'

export default class Debug extends Command {
  static description = `Enable local debug of ${EclipseChe.PRODUCT_NAME} server`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [DEBUG_PORT_FLAG]: DEBUG_PORT,
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
  }

  async run() {
    const { flags } = await this.parse(Debug)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Debug.id, flags })

    const tasks = newListr()
    tasks.add(CommonTasks.getTestKubernetesApiTasks())
    tasks.add(CheTasks.getDebugTasks())

    try {
      await tasks.run(ctx)
      this.log(`${EclipseChe.PRODUCT_NAME} server debug is available on localhost:${flags[DEBUG_PORT_FLAG]}.`)
      this.log('The program keeps running to enable port forwarding.')
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }
  }
}
