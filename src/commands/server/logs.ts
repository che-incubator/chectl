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

import { cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'

export default class Logs extends Command {
  static description = 'Collect Eclipse Che logs'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'deployment-name': cheDeployment,
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      env: 'CHE_LOGS'
    })
  }

  async run() {
    const { flags } = this.parse(Logs)
    const ctx: any = {}
    ctx.directory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()
    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.serverLogsTasks(flags, false))
    tasks.add(cheTasks.namespaceEventsTask(flags.chenamespace, this, false))

    try {
      this.log(`Eclipse Che logs will be available in '${ctx.directory}'`)
      await tasks.run(ctx)
      this.log('Command server:logs has completed successfully.')
    } catch (error) {
      this.error(error)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:logs has completed successfully.'
    })

    this.exit(0)
  }
}
