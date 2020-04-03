/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { boolean, string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'

import { accessToken, cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { WorkspaceTasks } from '../../tasks/workspace-tasks'

export default class Create extends Command {
  static description = 'Creates a workspace from a devfile'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    devfile: string({
      char: 'f',
      description: 'Path or URL to a valid devfile',
      env: 'DEVFILE_PATH',
      required: false,
    }),
    name: string({
      description: 'Workspace name: overrides the workspace name to use instead of the one defined in the devfile.',
      required: false,
    }),
    start: boolean({
      char: 's',
      description: 'Starts the workspace after creation',
      default: false
    }),
    debug: boolean({
      char: 'd',
      description: 'Debug workspace start. It is useful when workspace start fails and it is needed to print more logs on startup. This flag is used in conjunction with --start flag.',
      default: false
    }),
    'access-token': accessToken
  }

  async run() {
    const { flags } = this.parse(Create)
    const ctx: any = {}

    const apiTasks = new ApiTasks()
    const cheTasks = new CheTasks(flags)
    const workspaceTasks = new WorkspaceTasks(flags)

    const tasks = new Listr([], { renderer: 'silent' })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.retrieveEclipseCheUrl(flags))
    tasks.add(cheTasks.checkEclipseCheStatus())
    tasks.add(workspaceTasks.getWorkspaceCreateTask(flags.devfile, flags.name))
    if (flags.start) {
      tasks.add(workspaceTasks.getWorkspaceStartTask(flags.debug))
    }
    tasks.add(workspaceTasks.getWorkspaceIdeUrlTask())

    try {
      await tasks.run(ctx)
      this.log(`Workspace successfully ${flags.start ? 'started' : 'created'}. Workspace IDE URL:`)
      cli.url(ctx.workspaceIdeURL, ctx.workspaceIdeURL)
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:create has completed successfully.'
    })

    this.exit(0)
  }
}
