/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command, { flags } from '@oclif/command'
import { cli } from 'cli-ux'
import Listr = require('listr')
import * as notifier from 'node-notifier'

import { accessToken, cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { WorkspaceTasks } from '../../tasks/workspace-tasks'

export default class Start extends Command {
  static description = 'Starts a workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    debug: flags.boolean({
      char: 'd',
      description: 'Debug workspace start. It is useful when workspace start fails and it is needed to print more logs on startup.',
      default: false
    }),
    'access-token': accessToken,
    chenamespace: cheNamespace,
  }

  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to start',
      required: true
    }
  ]

  async run() {
    const { flags } = this.parse(Start)
    const { args } = this.parse(Start)
    const ctx: any = {}

    const tasks = new Listr([], { renderer: 'silent' })

    const apiTasks = new ApiTasks()
    const cheTasks = new CheTasks(flags)
    const workspaceTasks = new WorkspaceTasks(flags)

    ctx.workspaceId = args.workspace
    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.retrieveEclipseCheUrl(flags))
    tasks.add(cheTasks.checkEclipseCheStatus())
    tasks.add(workspaceTasks.getWorkspaceStartTask(flags.debug))
    tasks.add(workspaceTasks.getWorkspaceIdeUrlTask())

    try {
      await tasks.run(ctx)
      this.log('Workspace successfully started. Workspace IDE URL:')
      cli.url(ctx.workspaceIdeURL, ctx.workspaceIdeURL)
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:start has completed successfully.'
    })

    this.exit(0)
  }
}
