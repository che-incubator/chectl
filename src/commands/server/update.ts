// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'

import { HelmHelper } from '../../helpers/helm'
import { MinikubeHelper } from '../../helpers/minikube'

export default class Update extends Command {
  static description = 'Update Eclipse Che Server'

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
    const { flags } = this.parse(Update)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const mh = new MinikubeHelper()
    const helm = new HelmHelper()
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: this.warn('Not implemented yet') },
      { title: 'Verify if Che is running', skip: this.warn('Not implemented yet') },
      { title: 'Rolling out Che Server', skip: this.warn('Not implemented yet') },
      { title: 'Waiting for the new Che Server pod to be created', skip: this.warn('Not implemented yet')},
      { title: 'Waiting for the new Che Server to start', skip: this.warn('Not implemented yet')},
      { title: 'Retrieving Che Server URL', skip: this.warn('Not implemented yet')},
    ])

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:update has completed.'
    })
  }
}
