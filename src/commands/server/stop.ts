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
import * as commandExists from 'command-exists'
import * as execa from 'execa'

import { CheHelper } from '../../api/che'

export default class Stop extends Command {
  static description = 'stop Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper()
    const tasks = new Listr([
      {
        title: `Verify if namespace ${flags.chenamespace} exist`,
        task: async () => {
          if (!await che.cheNamespaceExist(flags.chenamespace)) {
            this.error(`E_BAD_NS - Namespace does not exist.\nThe Kubernetes Namespace "${flags.chenamespace}" doesn't exist, Che Server cannot be stopped.\nFix with: verify the namespace where Che is running (kubectl get --all-namespaces deployment | grep che)\nhttps://github.com/eclipse/che`, {code: 'EBADNS'})
          }
        }
      },
      {
        title: 'Verify if helm is installed',
        task: () => this.checkIfInstalled('helm')
      },
      {
        title: 'Stopping Che server',
        task: () => this.deleteChe()
      },
    ])

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:stop has completed.'
    })
  }

  checkIfInstalled(commandName: string) {
    if (!commandExists.sync(commandName)) {
      throw new Error(`ERROR: ${commandName} is not installed.`)
    }
  }

  async deleteChe() {
    let command = 'helm delete che --purge'
    await execa.shell(command, { timeout: 10000 })
  }
}
