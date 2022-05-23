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
import { integer } from '@oclif/parser/lib/flags'
import * as Listr from 'listr'

import { ChectlContext } from '../../api/context'
import { cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, wrapCommandError } from '../../util'

export default class Debug extends Command {
  static description = 'Enable local debug of Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'debug-port': integer({
      description: 'Eclipse Che server debug port',
      default: 8000,
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Debug)
    flags.chenamespace = flags.chenamespace || await findWorkingNamespace(flags)
    const ctx = await ChectlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Debug.id, flags })
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()
    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })

    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add(cheTasks.getCheckCheNamespaceExistsTasks(flags, this))
    tasks.add(cheTasks.getDebugTasks(flags))

    try {
      await tasks.run(ctx)
      this.log(`Eclipse Che server debug is available on localhost:${flags['debug-port']}.`)
      this.log('The program keeps running to enable port forwarding.')
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }
  }
}
