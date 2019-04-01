/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'

export default class Stop extends Command {
  static description = 'stop a running Che workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che server is deployed',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
    'listr-renderer': string({
      description: 'Listr renderer. Can be \'default\', \'silent\' or \'verbose\'',
      default: 'default'
    }),
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if Che is responding', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if the workspaces is running', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Stop the workspace', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Waiting for the workspace resources to be deleted', skip: () => 'Not implemented yet', task: () => {}},
    ], {renderer: flags['listr-renderer'] as any})

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:stop has completed.'
    })
  }
}
