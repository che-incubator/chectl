// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'

import { CheHelper } from '../../helpers/che'

export default class Start extends Command {
  static description = 'create and start a Che workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'kubernetes namespace where Che server is deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE',
    }),
    devfile: string({
      char: 'f',
      description: 'path to a valid devfile',
      env: 'DEVFILE_PATH',
      required: false,
    }),
    workspaceconfig: string({
      char: 'w',
      description: 'path to a valid workspace configuration json file',
      env: 'WORKSPACE_CONFIG_JSON_PATH',
      required: false,
    }),
  }

  async run() {
    const { flags } = this.parse(Start)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper()
    const tasks = new Listr([
      { title: 'Verify if Che server is running', task: async () => { if (!await che.isCheServerReady(flags.chenamespace)) { this.error(`E_SRV_NOT_RUNNING - Che Server is not running.\nChe Server cannot be found in Kubernetes Namespace "${flags.chenamespace}". Have you already start it?\nFix with: start Che server: chectl server:start\nhttps://github.com/eclipse/che`, { code: 'E_SRV_NOT_RUNNNG'}) } } },
      { title: `Create workspace from Devfile ${flags.devfile}`, enabled: () => flags.devfile !== undefined, task: async (ctx: any) => { ctx.workspaceIdeURL = await che.createWorkspaceFromDevfile(flags.chenamespace, flags.devfile) } },
      { title: `Create workspace from Workspace Config ${flags.workspaceconfig}`, enabled: () => flags.workspaceconfig !== undefined, task: async (ctx: any) => { ctx.workspaceIdeURL = await che.createWorkspaceFromWorkspaceConfig(flags.chenamespace, flags.workspaceconfig) } },
    ])

    try {
      let ctx = await tasks.run()
      this.log('\nWorkspace IDE URL:')
      cli.url(ctx.workspaceIdeURL, ctx.workspaceIdeURL)
      this.log('\n')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:start has completed successfully.'
    })
  }
}
