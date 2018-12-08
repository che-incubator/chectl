// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'

export default class List extends Command {
  static description = 'List Che workspaces'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che server is deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE'
    }),
  }

  async run() {
    // const { flags } = this.parse(List)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: this.warn('Not implemented yet') },
      { title: 'Verify if Che is running', skip: this.warn('Not implemented yet') },
      { title: 'Get Workspaces', skip: this.warn('Not implemented yet') },
    ])

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
