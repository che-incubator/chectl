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

import { cheNamespace, listrRenderer } from '../../common-flags'

export default class Update extends Command {
  static description = 'update Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Update)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: this.warn('Not implemented yet') },
      { title: 'Verify if Che is running', skip: this.warn('Not implemented yet') },
      { title: 'Rolling out Che Server', skip: this.warn('Not implemented yet') },
      { title: 'Waiting for the new Che Server pod to be created', skip: this.warn('Not implemented yet') },
      { title: 'Waiting for the new Che Server to start', skip: this.warn('Not implemented yet') },
      { title: 'Retrieving Che Server URL', skip: this.warn('Not implemented yet') },
    ], { renderer: flags['listr-renderer'] as any })

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:update has completed.'
    })
  }
}
