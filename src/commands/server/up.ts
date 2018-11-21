// tslint:disable:object-curly-spacing
import { Command, flags } from '@oclif/command'
import { execSync } from 'child_process'
import * as execa from 'execa'
// import { string } from '@oclif/parser/lib/flags'

export default class Up extends Command {
  static description = 'Start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chepath: flags.string({
      char: 'p',
      description: 'path to Che local git repository',
      default: '~/github/che',
      env: 'CHE_LOCAL_GIT_REPO'
    }),
    chenamespace: flags.string({
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
      { title: 'Verify that minikube is installed', task: () => this.checkIfInstalled('minikube') },
      { title: 'Verify that helm is installed', task: () => this.checkIfInstalled('helm') },
      { title: 'Wait 10 seconds', task: () => execa('sleep', ['2']) },
      { title: 'Verify that minikube is running', task: () => this.checkMinikubeStatus() },
      { title: 'Verify that minikube ingress addon is enabled', task: () => this.checkIfMinikubeIngressAddon() },
      { title: 'Verify that minikube is running', task: () => this.checkClusterRoleBinding() },
      { title: 'Verify that minikube is running', task: () => this.checkTillerServiceAccount() },
      { title: 'Verify that minikube is running', task: () => this.checkTillerServiceAccount() },
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

    tasks.run().then(
      // this.preFlightChecks()
      // this.configureMinikube()
      // this.installHelm(flags)
      // this.deployChe(flags)
      // const path = require('path')
      notifier.notify({
        title: 'chectl',
        message: 'Command server:up has completed.',
        // icon: path.join(__dirname, 'che.png')
      }))
    // this.exit(0))
  }

  // preFlightChecks() {
  //   this.checkPrerequisites()
  //   this.checkMinikubeStatus()
  // }

  // checkPrerequisites() {
  //   this.checkIfInstalled('minishift')
  //   this.checkIfInstalled('helm')
  // }

  checkIfInstalled(commandName: string) {
    let commandExistsSync = require('command-exists').sync
    if (!commandExistsSync(commandName)) {
      throw new Error('ERROR: minikube is not installed.')
    }
  }

  checkMinikubeStatus() {
    const { stdout } = execa.shellSync('minikube status', { timeout: 10000 })
    if (!stdout.includes('Running')) {
      throw new Error('minikube is not running')
    }
  }

  checkIfMinikubeIngressAddon() {
    const { stdout } = execa.shellSync('minikube addons list', { timeout: 10000 })
    if (!stdout.includes('ingress: enabled')) {
      throw new Error('minikube ingress addon is not enabled')
    }
  }

  checkClusterRoleBinding() {
    execa.shellSync('kubectl get clusterrolebinding add-on-cluster-admin', { timeout: 10000 })
  }

  checkTillerServiceAccount() {
    execa.shellSync('kubectl get serviceaccounts tiller --namespace kube-system', { timeout: 10000 })
  }


    try {
      execSync('kubectl get clusterrolebinding add-on-cluster-admin', { timeout: 10000 })
      // this.log("RoleBinding \'add-on-cluster-admin\' already exists, no need to create it")
    } catch {
      try {
        execSync('kubectl create clusterrolebinding add-on-cluster-admin --clusterrole=cluster-admin --serviceaccount=kube-system:default', { timeout: 10000 })
        // this.log("RoleBinding \'add-on-cluster-admin\' created successfully")
      } catch (error) {
        this.error(`${error}`, { exit: 1 })
      }
    }
  }

  async installHelm(flags: any) {
    try {
      execSync('kubectl get serviceaccounts tiller --namespace kube-system', { timeout: 10000 })
      // this.log("Service account \'tiller\' already exists, no need to create it")
    } catch {
      try {
        execSync('kubectl create serviceaccount tiller --namespace kube-system', { timeout: 10000 })
        // this.log("Service account \'tiller\' created successfully")
        let wait = ms => new Promise((r, _j) => setTimeout(r, ms))
        await wait(1000)
      } catch (error) {
        this.error(`${error}`, { exit: 1 })
      }
    }

    try {
      execSync(`kubectl apply -f ${flags.chepath}/deploy/kubernetes/helm/che/tiller-rbac.yaml`, { timeout: 10000 })
      // this.log('Tiller RBAC created successfully')
    } catch (error) {
      this.error(`${error}`, { exit: 1 })
    }

    try {
      execSync('kubectl get services tiller-deploy -n kube-system', { timeout: 10000 })
      // this.log('Tiller service already exists, no need to deploy it')
    } catch {
      try {
        execSync('helm init --service-account tiller', { timeout: 10000 })
        // this.log('Tiller has been deployed successfully')
      } catch (error) {
        this.error(`${error}`, { exit: 1 })
      }
    }
  }

  deployChe(flags: any) {
    let command = `helm upgrade \\
                            --install che \\
                            --namespace ${flags.chenamespace} \\
                            --set global.ingressDomain=$(minikube ip).nip.io \\
                            --set cheImage=eclipse/che-server:nightly \\
                            --set global.cheWorkspacesNamespace=${flags.chenamespace} \\
                            ${flags.chepath}/deploy/kubernetes/helm/che/`

    try {
      const out = execSync(command, { timeout: 10000 })
      // this.log("Command 'helm upgrade' executed successfully")
      // this.log(out.toString('utf8'))
    } catch (error) {
      this.error(`${error}`, { exit: 1 })
    }
  }
}
