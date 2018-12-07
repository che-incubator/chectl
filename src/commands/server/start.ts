// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { CheHelper } from '../../helpers/che'
import { HelmHelper } from '../../helpers/helm'
import { MinikubeHelper } from '../../helpers/minikube'
const workingDir = path.resolve('.')
export default class Start extends Command {
  static description = 'Start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE'
    }),
    cheimage: string({
      char: 'i',
      description: 'Che server container image',
      default: 'eclipse/che-server:nightly',
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: `${workingDir}/src/templates`,
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    })
  }

  async run() {
    const { flags } = this.parse(Start)
    const bootTimeout = parseInt(flags.cheboottimeout, 10)
    const mh = new MinikubeHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const tasks = new Listr([
      { title: 'Verify if kubectl is installed', task: () => this.checkIfInstalled('kubectl') },
      { title: 'Verify if minikube is installed', task: () => this.checkIfInstalled('minikube') },
      { title: 'Verify if helm is installed', task: () => this.checkIfInstalled('helm') },
      { title: 'Verify if minikube is running', task: async (ctx: any) => { ctx.isMinikubeRunning = await mh.isMinikubeRunning() }},
      { title: 'Start minikube', skip: (ctx: any) => { if (ctx.isMinikubeRunning) { return 'Minikube is already running.' } }, task: () => mh.startMinikube() },
      { title: 'Verify minikube memory configuration', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify kubernetes version', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if minikube ingress addon is enabled', task: async (ctx: any) => { ctx.isIngressAddonEnabled = await mh.isIngressAddonEnabled() } },
      { title: 'Enable minikube ingress addon', skip: (ctx: any) => { if (ctx.isIngressAddonEnabled) { return 'Ingress addon is already enabled.' } }, task: () => mh.enableIngressAddon() },
      { title: 'Verify if Tiller Role Binding exist', task: async (ctx: any) => { ctx.tillerRoleBindingExist = await helm.tillerRoleBindingExist() } },
      { title: 'Create Tiller Role Binding', skip: (ctx: any) => { if (ctx.tillerRoleBindingExist) { return 'Tiller Role Binding already exist.' } }, task: () => helm.createTillerRoleBinding() },
      { title: 'Verify if Tiller Service Account exists', task: async (ctx: any) => { ctx.tillerServiceAccountExist = await helm.tillerServiceAccountExist() } },
      { title: 'Create Tiller Service Account', skip: (ctx: any) => { if (ctx.tillerServiceAccountExist) { return 'Tiller Service Account already exist.' } }, task: () => helm.createTillerServiceAccount() },
      { title: 'Create Tiller RBAC', task: () => helm.createTillerRBAC(flags.templates) },
      { title: 'Verify if Tiller service exist', task: async (ctx: any) => { ctx.tillerServiceExist = await helm.tillerServiceExist() } },
      { title: 'Create Tiller Service', skip: (ctx: any) => { if (ctx.tillerServiceExist) { return 'Tiller Service already exist.' } }, task: () => helm.createTillerService() },
      { title: 'Pre-pull Che server image', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if Che server is already running', task: async (ctx: any) => { ctx.isCheRunning = await che.isCheServerReady(flags.chenamespace) }},
      { title: 'Deploy Che Server', skip: (ctx: any) => { if (ctx.isCheRunning) { return 'Che is already running.' } }, task: () => this.deployChe(flags) },
      { title: 'Waiting for Che Server pod to be created', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Waiting for Che Server to start and respond', skip: (ctx: any) => { if (ctx.isCheRunning) { return 'Che is already running.' } }, task: async () => che.isCheServerReady(flags.chenamespace, bootTimeout)},
      { title: 'Retrieving Che Server URL', task: async (ctx: any, task: any) => { ctx.cheURL = await che.cheURL(flags.chenamespace); task.title = await `${task.title}...${ctx.cheURL}` } },
      { title: 'Open Che Server in browser', skip: () => 'Not implemented yet', task: () => {}},
    ])

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed.'
    })
  }

  async checkIfInstalled(commandName: string) {
    let commandExists = require('command-exists')
    if (!await commandExists(commandName)) {
      throw new Error(`ERROR: ${commandName} is not installed.`)
    }
  }

  async deployChe(flags: any) {
    let command = `helm upgrade \\
                            --install che \\
                            --namespace ${flags.chenamespace} \\
                            --set global.ingressDomain=$(minikube ip).nip.io \\
                            --set cheImage=${flags.cheimage} \\
                            --set global.cheWorkspacesNamespace=${flags.chenamespace} \\
                            ${flags.templates}/kubernetes/helm/che/`
    await execa.shell(command, { timeout: 10000 })
  }
}
