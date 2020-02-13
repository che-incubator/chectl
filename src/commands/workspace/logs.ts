/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as os from 'os'
import * as path from 'path'

import { listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'

export default class Logs extends Command {
  static description = 'Collect workspace(s) logs'

  static flags = {
    help: flags.help({ char: 'h' }),
    'listr-renderer': listrRenderer,
    workspace: string({
      char: 'w',
      description: 'Target workspace id. Can be found in workspace configuration \'id\' field.',
      required: true
    }),
    namespace: string({
      char: 'n',
      description: 'The namespace where workspace is located. Can be found in workspace configuration \'attributes.infrastructureNamespace\' field.',
      required: true
    }),
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      env: 'CHE_LOGS'
    })
  }

  async run() {
    const ctx: any = {}
    const { flags } = this.parse(Logs)
    ctx.directory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()

    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })
    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.workspaceLogsTasks(flags.namespace, flags.workspace))

    try {
      this.log(`Eclipse Che logs will be available in '${ctx.directory}'`)
      await tasks.run(ctx)

      if (!ctx['workspace-run']) {
        this.log(`Workspace ${flags.workspace} probably hasn't been started yet.`)
        this.log('The program will keep running and collecting logs...')
        this.log('Terminate the program when all logs are gathered...')
      }
    } catch (error) {
      this.error(error)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:logs has completed successfully.'
    })
  }
}
