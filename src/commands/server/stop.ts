// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'

import { HelmHelper } from '../../helpers/helm'
import { MinikubeHelper } from '../../helpers/minikube'

export default class Stop extends Command {
  static description = 'Start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE'
    }),
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if Che is deployed', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if helm is installed', task: () => this.checkIfInstalled('helm')},
      { title: 'Verify if the workspaces is running', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Stopping Che server', task: () => this.deleteChe(flags)},
      { title: 'Waiting for Che server to stop', skip: () => 'Not implemented yet', task: () => {}},
    ])

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:stop has completed.'
    })
  }

  async checkIfInstalled(commandName: string) {
    let commandExists = require('command-exists')
    if (!await commandExists(commandName)) {
      throw new Error(`ERROR: ${commandName} is not installed.`)
    }
  }

  async deleteChe(flags: any) {
    let command = 'helm delete che --purge'
    await execa.shell(command, { timeout: 10000 })
  }
}
