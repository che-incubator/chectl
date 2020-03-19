/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { cli } from 'cli-ux'
import * as notifier from 'node-notifier'

import Create from './create'

export default class Start extends Create {
  static description = 'Creates and starts workspace from devfile'

  async run() {
    const { flags } = this.parse(Create)
    flags.start = true

    const tasks = this.getWorkspaceCreateTasks(flags)
    tasks.add(
      {
        title: 'Warning',
        task: (_: any, task: any) => {
          const yellow = '\x1b[33m'
          const noColor = '\x1b[0m'
          task.title = `${yellow}This command is deprecated. Please use 'workspace:create --start' instead ${noColor}`
        }
      }
    )

    try {
      let ctx = await tasks.run()
      this.log('\nWorkspace IDE URL:')
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
