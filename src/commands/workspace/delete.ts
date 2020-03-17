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
import * as Listrq from 'listr'

import { CheHelper } from '../../api/che'
import { accessToken, cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'

export default class List extends Command {
  static description = 'delete workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    workspace: flags.string({
      char: 'w',
      description: 'The workspace id to delete',
      required: true
    }),
    'access-token': accessToken,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(List)
    const ctx: any = {}
    ctx.workspaces = []

    const apiTasks = new ApiTasks()
    const cheTasks = new CheTasks(flags)
    const cheHelper = new CheHelper(flags)
    const tasks = new Listrq(undefined, { renderer: flags['listr-renderer'] as any })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.retrieveEclipseCheUrl(flags))
    tasks.add(cheTasks.checkEclipseCheStatus())
    tasks.add({
      title: `Get workspace with id '${flags.workspace}'`,
      task: async (ctx, task) => {
        ctx.workspace = await cheHelper.getWorkspace(ctx.cheURL, flags.workspace, flags['access-token'])
        task.title = `${task.title}... done`
      }
    })
    tasks.add({
      title: `Delete workspace with id '${flags.workspace}'`,
      task: async (ctx, task) => {
        await cheHelper.deleteWorkspace(ctx.cheURL, flags.workspace, flags['access-token'])
        task.title = `${task.title}... done`
      }
    })

    try {
      await tasks.run(ctx)
    } catch (error) {
      this.error(error)
    }
  }
}
