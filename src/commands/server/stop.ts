// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'

import { CheHelper } from '../../helpers/che'

export default class Stop extends Command {
  static description = 'Stop Eclipse Che Server'

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
    const che = new CheHelper()
    const tasks = new Listr([
      { title: 'Verify if we can access Kubernetes API', skip: () => 'Not implemented yet', task: () => {}},
      { title: `Verify if namespace ${flags.chenamespace} exist`, task: async () => { if (!await che.cheNamespaceExist(flags.chenamespace)) { this.error(`E_BAD_NS - Namespace does not exist.\nThe Kubernetes Namespace "${flags.chenamespace}" doesn't exist, Che Server cannot be stopped.\nFix with: verify the namespace where Che is running (kubectl get --all-namespaces deployment | grep che)\nhttps://github.com/eclipse/che`, {code: 'EBADNS'}) } } },
      { title: 'Verify if Che server is already running', task: async () => { if (!await che.isCheServerReady(flags.chenamespace)) { this.error(`E_SRV_NOT_RUNNING - Che Server is not running.\nChe Server cannot be found in Kubernetes Namespace "${flags.chenamespace}". It may be already stopped.\nFix with: verify if Che is running (kubectl get --all-namespaces deployment | grep che)\nhttps://github.com/eclipse/che`, { code: 'ESRVNOTRUNNNG'}) } } },
      { title: 'Verify if helm is installed', task: () => this.checkIfInstalled('helm')},
      { title: 'Stopping Che server', task: () => this.deleteChe(flags)},
      { title: 'Waiting for Che server to stop', skip: () => 'Not implemented yet', task: () => {}},
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

  async checkIfInstalled(commandName: string) {
    let commandExists = require('command-exists')
    if (!await commandExists(commandName)) {
      throw new Error(`ERROR: ${commandName} is not installed.`)
    }
  }

  async deleteChe() {
    let command = 'helm delete che --purge'
    await execa.shell(command, { timeout: 10000 })
  }
}
