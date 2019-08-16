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

export default class List extends Command {
  static description = 'list Che workspaces'

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
    const { flags } = this.parse(List)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: this.warn('Not implemented yet') },
      { title: 'Verify if Che is running', skip: this.warn('Not implemented yet') },
      { title: 'Get Workspaces', skip: this.warn('Not implemented yet') },
    ], { renderer: flags['listr-renderer'] as any })

    // Use https://github.com/oclif/cli-ux/tree/supertable#clitable to dispalay:
    //  - workspace id
    //  - workspace state
    //  - workspace creation date ?
    //  - workspace stack ?

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:list has completed.'
    })
  }
}
