// tslint:disable:object-curly-spacing
// import { k8s } from '@kubernetes/client-node'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'

export default class Up extends Command {
  static description = 'Start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chepath: string({
      char: 'p',
      description: 'path to Che local git repository',
      default: '~/github/che',
      env: 'CHE_LOCAL_GIT_REPO'
    }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE'
    })
  }

  async run() {
    const { flags } = this.parse(Up)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const tasks = new Listr([
      { title: 'Verify if minikube is installed', task: () => this.checkIfInstalled('minikube') },
      { title: 'Verify if helm is installed', task: () => this.checkIfInstalled('helm') },
      { title: 'Verify if minikube is running', task: (ctx: any) => { ctx.minikubeIsRunning = this.isMinikubeRunning(ctx) }},
      { title: 'Start minikube', skip: (ctx: any) => { if (ctx.minikubeIsRunning) { return 'Minikube is already running' } }, task: () => this.startMinikube() },
      { title: 'Verify if minikube ingress addon is enabled', task: () => this.checkIfMinikubeIngressAddon() },
      { title: 'Verify if ClusterRoleBinding add-on-cluster-admin exist', task: () => this.checkClusterRoleBinding() },
      //execSync('kubectl create clusterrolebinding add-on-cluster-admin --clusterrole=cluster-admin --serviceaccount=kube-system:default', { timeout: 10000 })
      { title: 'Verify if Tiller Service Account exists', task: () => this.checkTillerServiceAccount() },
      // execSync('kubectl create serviceaccount tiller --namespace kube-system', { timeout: 10000 })
      { title: 'Create Tiller RBAC', task: () => this.createTillerRBAC(flags.chepath) },
      { title: 'Verify if tiller is running', task: () => this.checkTillerService() },
      //execSync('helm init --service-account tiller', { timeout: 10000 })
      // { title: 'Deploy Che', task: () => this.deployChe(flags) },
      { title: 'Verify if Che Pod has been created', task: () => this.checkIfChePodIsCreated(flags) }
      //
      // {
      //   title: 'Verify that minikube is running',
      //   task: () => execa.stdout('minikube', ['status']).then(result: string => {
      //     if (result !== )
      //   })
      // }
      // { title: 'Configure the Kubernetes cluster', task: () => this.configureMinikube() }
      // { title: 'Initialize Helm', task: () => this.installHelm(flags) },
      // { title: 'Deploy Eclipse Che server', task: () => this.deployChe(flags) }
    ])

    await tasks.run()
    // .then(
    // this.preFlightChecks()
    // this.configureMinikube()
    // this.installHelm(flags)
    // this.deployChe(flags)
    // const path = require('path')
    // icon: path.join(__dirname, 'che.png')
    // }))

    notifier.notify({
      title: 'chectl',
      message: 'Command server:up has completed.',
      // this.exit(0))
    })
  }

  async sleep() {
    await execa('sleep', ['2'])
  }
  // sleep(): Promise<number> {
  //   return new Promise((resolve, _reject) => {
  //     execa('sleep', ['2']).then(resolve(1))
  //   })
  // }

  async checkIfInstalled(commandName: string) {
    let commandExists = require('command-exists')
    if (!await commandExists(commandName)) {
      throw new Error('ERROR: minikube is not installed.')
    }
  }

  async isMinikubeRunning(ctx: any) {
    const { stdout, code } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
    // if (stdout.includes('Running')) {
    //   // throw new Error('minikube is not running')
    //    = true
    // } else {
    //   ctx.minikubeIsRunning = false
    // }
  }

  async startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: 120000 })
  }

  async checkIfMinikubeIngressAddon() {
    const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 10000 })
    if (!stdout.includes('ingress: enabled')) {
      throw new Error('minikube ingress addon is not enabled')
    }
  }

  async checkClusterRoleBinding() {
    await execa('kubectl', ['get', 'clusterrolebinding', 'add-on-cluster-admin'], { timeout: 10000 })
  }

  async checkTillerServiceAccount() {
    await execa('kubectl', ['get', 'serviceaccounts', 'tiller', '--namespace', 'kube-system'], { timeout: 10000 })
  }

  async createTillerRBAC(cheLocalRepoPath: any) {
    await execa.shell(`kubectl apply -f ${cheLocalRepoPath}/deploy/kubernetes/helm/che/tiller-rbac.yaml`, { timeout: 10000 })
  }

  async checkTillerService() {
    await execa('kubectl', ['get', 'services', 'tiller-deploy', '-n', 'kube-system'], { timeout: 10000 })
  }

  async checkIfChePodIsCreated(flags: flags) {
    const k8s = require('@kubernetes/client-node')
    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    const k8sApi = kc.makeApiClient(k8s.Core_v1Api)

    await k8sApi.listNamespacedPod(flags.chenamespace, undefined, undefined, undefined, undefined, 'app=che')
      .then(res => {
        res.body.items.forEach(pod => {
          console.log(`Pod name: ${pod.metadata.name}`)
        })
        // (pod => {
        //   console.log(`Pod: ${pod.metadata.namespace}/${pod.metadata.name}`)
        // })
      }).catch(err => console.error(`Error: ${err.message}`))
  }

  async deployChe(flags: any) {
    let command = `helm upgrade \\
                            --install che \\
                            --namespace ${flags.chenamespace} \\
                            --set global.ingressDomain=$(minikube ip).nip.io \\
                            --set cheImage=eclipse/che-server:nightly \\
                            --set global.cheWorkspacesNamespace=${flags.chenamespace} \\
                            ${flags.chepath}/deploy/kubernetes/helm/che/`
    await execa.shell(command, { timeout: 10000 })
  }
}
