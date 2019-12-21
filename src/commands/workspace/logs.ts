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

import { accessToken, cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'

export default class Logs extends Command {
  static description = 'Retrieve workspace logs'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'access-token': accessToken,
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
    flags.directory = path.resolve(flags.directory, flags.chenamespace)

    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.verifyWorkspaceRunTask(flags, this))
    tasks.add(cheTasks.workspaceLogsTasks(flags, this))

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:logs has completed successfully.'
    })
  }
}
