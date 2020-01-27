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

import { accessToken, cheNamespace, listrRenderer } from '../../common-flags'

export default class Stop extends Command {
  static description = 'stop a running workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'access-token': accessToken,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: () => 'Not implemented yet', task: () => { } },
      { title: 'Verify if Eclipse Che is responding', skip: () => 'Not implemented yet', task: () => { } },
      { title: 'Verify if the workspaces is running', skip: () => 'Not implemented yet', task: () => { } },
      { title: 'Stop the workspace', skip: () => 'Not implemented yet', task: () => { } },
      { title: 'Waiting for the workspace resources to be deleted', skip: () => 'Not implemented yet', task: () => { } },
    ], { renderer: flags['listr-renderer'] as any })

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:stop has completed.'
    })
  }
}
