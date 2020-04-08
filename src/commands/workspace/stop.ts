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
import { cli } from 'cli-ux'
import Listr = require('listr')
import * as notifier from 'node-notifier'

import { accessToken, cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { WorkspaceTasks } from '../../tasks/workspace-tasks'

export default class Stop extends Command {
  static description = 'Stop a running workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    'access-token': accessToken,
    chenamespace: cheNamespace,
  }

  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to stop',
      required: true
    }
  ]

  async run() {
    const { flags } = this.parse(Stop)
    const { args } = this.parse(Stop)
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
    tasks.add(workspaceTasks.getWorkspaceStopTask())

    try {
      await tasks.run(ctx)
      cli.log('Workspace successfully stopped.')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:stop has completed successfully.'
    })

    this.exit(0)
  }
}
