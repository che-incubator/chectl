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

import { cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { K8sTasks } from '../../tasks/platforms/k8s'

export default class Logs extends Command {
  static description = 'Collect workspace logs'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    follow: flags.boolean({
      description: 'Follow workspace creation logs',
      default: false
    }),
    workspace: string({
      char: 'w',
      description: 'Target workspace. Can be omitted if only one Workspace is running'
    }),
    directory: string({
      char: 'd',
      description: 'Directory to store logs into'
    })
  }

  async run() {
    const ctx: any = {}
    const { flags } = this.parse(Logs)
    ctx.directory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
    const cheTasks = new CheTasks(flags)
    const k8sTasks = new K8sTasks()

    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })
    tasks.add(k8sTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    if (!flags.follow) {
      tasks.add(cheTasks.verifyWorkspaceRunTask(flags, this))
    }
    tasks.add(cheTasks.workspaceLogsTasks(flags))

    try {
      await tasks.run(ctx)

      if (flags.follow) {
        this.log(`chectl is still running and keeps collecting logs in '${ctx.directory}'`)
      } else {
        this.log(`Workspace logs is available in '${ctx.directory}'`)
        this.log('Command workspace:logs has completed successfully.')
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
