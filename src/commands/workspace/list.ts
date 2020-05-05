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
import * as Listrq from 'listr'

import { CheHelper } from '../../api/che'
import { accessToken, cheNamespace, skipKubeHealthzCheck } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'

export default class List extends Command {
  static description = 'list workspaces'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'access-token': accessToken,
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  async run() {
    const { flags } = this.parse(List)
    const ctx: any = {}
    ctx.workspaces = []

    const apiTasks = new ApiTasks()
    const cheTasks = new CheTasks(flags)
    const tasks = new Listrq(undefined, { renderer: 'silent' })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.retrieveEclipseCheUrl(flags))
    tasks.add(cheTasks.checkEclipseCheStatus())
    tasks.add({
      title: 'Get workspaces',
      task: async (ctx, task) => {
        const cheHelper = new CheHelper(flags)
        ctx.workspaces = await cheHelper.getAllWorkspaces(ctx.cheURL, flags['access-token'])
        task.title = `${task.title}... done`
      }
    })

    try {
      await tasks.run(ctx)
      this.printWorkspaces(ctx.workspaces)
    } catch (error) {
      this.error(error.message)
    }
  }

  private printWorkspaces(workspaces: [any]): void {
    const data: any[] = []
    workspaces.forEach((workspace: any) => {
      data.push({
        id: workspace.id,
        name: workspace.devfile.metadata.name,
        namespace: workspace.attributes.infrastructureNamespace,
        status: workspace.status,
        created: new Date(parseInt(workspace.attributes.created, 10)).toISOString(),
        updated: workspace.attributes.updated ? new Date(parseInt(workspace.attributes.updated, 10)).toISOString() : ''
      })
    })
    cli.table(data, { id: {}, name: {}, namespace: {}, status: {}, created: {}, updated: {} })
  }
}
