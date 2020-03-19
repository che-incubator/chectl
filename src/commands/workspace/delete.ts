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
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { accessToken, cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { cli } from 'cli-ux'

export default class Delete extends Command {
  static description = 'delete workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    workspace: flags.string({
      char: 'w',
      description: 'The workspace id to delete',
      required: true
    }),
    'delete-namespace': flags.boolean({
      description: 'Indicates that a namespace where workspace is created will be deleted as well',
      default: false
    }),
    'access-token': accessToken
  }

  async run() {
    const { flags } = this.parse(Delete)
    const ctx: any = {}
    ctx.workspaces = []

    const apiTasks = new ApiTasks()
    const cheTasks = new CheTasks(flags)
    const cheHelper = new CheHelper(flags)
    const kubeHelper = new KubeHelper(flags)
    const tasks = new Listrq(undefined, { renderer: 'silent' })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.retrieveEclipseCheUrl(flags))
    tasks.add(cheTasks.checkEclipseCheStatus())
    tasks.add({
      title: `Get workspace with id '${flags.workspace}'`,
      task: async (ctx, task) => {
        const workspace = await cheHelper.getWorkspace(ctx.cheURL, flags.workspace, flags['access-token'])
        ctx.infrastructureNamespace = workspace.attributes.infrastructureNamespace
        task.title = `${task.title}... done`
      }
    })
    tasks.add({
      title: `Delete workspace with id '${flags.workspace}'`,
      task: async (ctx, task) => {
        await cheHelper.deleteWorkspace(ctx.cheURL, flags.workspace, flags['access-token'])
        cli.log(`Workspace with id '${flags.workspace}' deleted.`)
        task.title = `${task.title}... done`
      }
    })
    tasks.add({
      title: 'Verify if namespace exists',
      enabled: () => flags['delete-namespace'],
      task: async (ctx, task) => {
        task.title = `${task.title} '${ctx.infrastructureNamespace}'`
        if (ctx.infrastructureNamespace === flags.chenamespace) {
          cli.warn(`It is not possible to delete namespace '${ctx.infrastructureNamespace}' since it is used for Eclipse Che deployment.`)
          return
        }

        ctx.infrastructureNamespaceExists = await kubeHelper.namespaceExist(ctx.infrastructureNamespace)
        if (ctx.infrastructureNamespaceExists) {
          task.title = `${task.title}... found`
        } else {
          task.title = `${task.title}... not found`
        }
      }
    })
    tasks.add({
      title: 'Delete namespace',
      skip: ctx => !ctx.infrastructureNamespaceExists,
      enabled: () => flags['delete-namespace'],
      task: async (ctx, task) => {
        task.title = `${task.title} '${ctx.infrastructureNamespace}'`
        await kubeHelper.deleteNamespace(ctx.infrastructureNamespace)
        cli.log(`Namespace '${ctx.infrastructureNamespace}' deleted.`)
        task.title = `${task.title}... done`
      }
    })

    try {
      await tasks.run(ctx)
    } catch (error) {
      this.error(error)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:delete has completed successfully.'
    })

    this.exit(0)
  }
}
