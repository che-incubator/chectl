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
import * as path from 'path'

import { cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { K8sTasks } from '../../tasks/platforms/k8s'

export default class Logs extends Command {
  static description = 'Retrieve workspace logs'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    workspace: string({
      char: 'w',
      description: 'Target workspace. Can be omitted if only one Workspace is running'
    }),
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      default: './logs'
    })
  }

  async run() {
    const { flags } = this.parse(Logs)
    const cheTasks = new CheTasks(flags)
    const k8sTasks = new K8sTasks()

    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })
    tasks.add(k8sTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.verifyWorkspaceRunTask(flags, this))
    tasks.add(cheTasks.workspaceLogsTasks(flags, false))

    try {
      await tasks.run()
      this.log('Command workspace:logs has completed successfully.')
    } catch (error) {
      this.error(error)
    } finally {
      this.log(`Eclipse Che logs will be available in '${path.resolve(flags.directory)}'`)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:logs has completed successfully.'
    })

    this.exit(0)
  }
}
