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

export default class List extends Command {
  static description = 'list workspaces'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'access-token': accessToken,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(List)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: this.warn('Not implemented yet') },
      { title: 'Verify if Eclipse Che is running', skip: this.warn('Not implemented yet') },
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
