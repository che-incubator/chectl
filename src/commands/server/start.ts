// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import { mkdirp } from 'fs-extra'
import * as Listr from 'listr'
import { ncp } from 'ncp'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { CheHelper } from '../../helpers/che'
import { HelmHelper } from '../../helpers/helm'
import { MinikubeHelper } from '../../helpers/minikube'
export default class Start extends Command {
  static description = 'start Eclipse Che Server'

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
      default: path.join(__dirname, '../../../../chectl/templates'),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    }),
    debug: flags.boolean({
      char: 'd',
      description: 'Starts chectl in debug mode',
      default: false
    })
  }

  async run() {
    const { flags } = this.parse(Start)
    const bootTimeout = parseInt(flags.cheboottimeout, 10)
    const mh = new MinikubeHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const listr_renderer = (flags.debug) ? 'verbose' : 'default'
    const tasks = new Listr([
      { title: 'Verify if kubectl is installed', task: async () => { if (!await commandExists('kubectl')) { this.error('E_REQUISITE_NOT_FOUND') } } },
      { title: 'Verify if minikube is installed', task: async () => { if (!await this.checkIfInstalled('minikube')) { this.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' }) } } },
      { title: 'Verify if helm is installed', task: async () => { if (!await commandExists('helm')) { this.error('E_REQUISITE_NOT_FOUND') } } },
      { title: 'Verify if minikube is running', task: async (ctx: any) => { ctx.isMinikubeRunning = await mh.isMinikubeRunning() } },
      { title: 'Start minikube', skip: (ctx: any) => { if (ctx.isMinikubeRunning) { return 'Minikube is already running.' } }, task: () => mh.startMinikube() },
      // { title: 'Verify minikube memory configuration', skip: () => 'Not implemented yet', task: () => {}},
      // { title: 'Verify kubernetes version', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if minikube ingress addon is enabled', task: async (ctx: any) => { ctx.isIngressAddonEnabled = await mh.isIngressAddonEnabled() } },
      { title: 'Enable minikube ingress addon', skip: (ctx: any) => { if (ctx.isIngressAddonEnabled) { return 'Ingress addon is already enabled.' } }, task: () => mh.enableIngressAddon() },
      { title: 'Verify if Tiller Role Binding exist', task: async (ctx: any) => { ctx.tillerRoleBindingExist = await helm.tillerRoleBindingExist() } },
      { title: 'Create Tiller Role Binding', skip: (ctx: any) => { if (ctx.tillerRoleBindingExist) { return 'Tiller Role Binding already exist.' } }, task: () => helm.createTillerRoleBinding() },
      { title: 'Verify if Tiller Service Account exists', task: async (ctx: any) => { ctx.tillerServiceAccountExist = await helm.tillerServiceAccountExist() } },
      { title: 'Create Tiller Service Account', skip: (ctx: any) => { if (ctx.tillerServiceAccountExist) { return 'Tiller Service Account already exist.' } }, task: () => helm.createTillerServiceAccount() },
      { title: 'Create Tiller RBAC', task: () => helm.createTillerRBAC(flags.templates) },
      { title: 'Verify if Tiller service exist', task: async (ctx: any) => { ctx.tillerServiceExist = await helm.tillerServiceExist() } },
      { title: 'Create Tiller Service', skip: (ctx: any) => { if (ctx.tillerServiceExist) { return 'Tiller Service already exist.' } }, task: () => helm.createTillerService() },
      // { title: 'Pre-pull Che server image', skip: () => 'Not implemented yet', task: () => {}},
      { title: `Verify if namespace ${flags.chenamespace} exist`, task: async (ctx: any, task: any) => { if (ctx.cheNamespaceExist = await che.cheNamespaceExist(flags.chenamespace)) { task.title = `${task.title}...It does.` } else { task.title = `${task.title}...It doesn't.` } } },
      { title: 'Verify if Che server is already running', skip: (ctx: any) => { if (!ctx.cheNamespaceExist) { ctx.isCheRunning = false; return 'Che namespace doesn\'t exist.' } }, task: async (ctx: any) => { ctx.isCheRunning = await che.isCheServerReady(flags.chenamespace) } },
      { title: 'Deploy Che Server', skip: (ctx: any) => { if (ctx.isCheRunning) { return 'Che is already running.' } }, task: () => this.deployChe(flags) },
      // { title: 'Waiting for Che Server pod to be created', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Waiting for Che Server to start and respond', skip: (ctx: any) => { if (ctx.isCheRunning) { return 'Che is already running.' } }, task: () => che.isCheServerReady(flags.chenamespace, bootTimeout) },
      { title: 'Retrieving Che Server URL', task: async (ctx: any, task: any) => { ctx.cheURL = await che.cheURL(flags.chenamespace); task.title = await `${task.title}...${ctx.cheURL}` } },
      // { title: 'Open Che Server Dashboard in browser', enable: () => false /* Doesn\'t work when chectl is packaged with zeit/pkg */, task: async (ctx: any) => { process.platform === 'linux' ? await cli.open(ctx.cheURL, { app: 'xdg-open' }) : await cli.open(ctx.cheURL, { app: 'open' }) }}
    ], {
      renderer: listr_renderer
    })

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })
  }

  async checkIfInstalled(commandName: string): Promise<boolean> {
    try {
      return await commandExists(commandName)
    } catch {
      return false
    }
  }

  async deployChe(flags: any) {
    const srcDir = path.join(flags.templates, '/kubernetes/helm/che/')
    const destDir = path.join(this.config.cacheDir, '/templates/kubernetes/helm/che/')

    await mkdirp(destDir)
    await ncp(srcDir, destDir, {}, (err: Error) => { if (err) { throw err } })

    let command = `helm upgrade \\
                            --install che \\
                            --namespace ${flags.chenamespace} \\
                            --set global.ingressDomain=$(minikube ip).nip.io \\
                            --set cheImage=${flags.cheimage} \\
                            --set global.cheWorkspacesNamespace=${flags.chenamespace} \\
                            ${destDir}`
    await execa.shell(command, { timeout: 10000 })
  }
}
