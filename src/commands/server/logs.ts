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
import { string } from '@oclif/parser/lib/flags'
import * as Listr from 'listr'

import { ChectlContext } from '../../api/context'
import { cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandSuccessMessage, wrapCommandError } from '../../util'

export default class Logs extends Command {
  static description = 'Collect Eclipse Che logs'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      env: 'CHE_LOGS',
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Logs)
    flags.chenamespace = await findWorkingNamespace(flags)
    const ctx = await ChectlContext.initAndGet(flags, this)

    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()
    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Logs.id, flags })
    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.serverLogsTasks(flags, false))

    try {
      this.log(`Eclipse Che logs will be available in '${ctx.directory}'`)
      await tasks.run(ctx)
      this.log(getCommandSuccessMessage())
    } catch (err) {
      this.error(wrapCommandError(err))
    }

    this.exit(0)
  }
}
