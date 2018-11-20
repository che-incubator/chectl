// tslint:disable:no-console
import {Command, flags} from '@oclif/command'
// import { string } from '@oclif/parser/lib/flags';
// import sleep from 'await-sleep'
import {exec} from 'child_process'
// import {commandExists} from 'command-exists'
import {isNull} from 'util'

export default class Run extends Command {
  static description = 'Run Eclipse Che'

  static flags = {
    help: flags.help({char: 'h'}),
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
    const {flags} = this.parse(Run)
    await preFlightChecks() {
      await configureMinikube()
    }
    await installHelm(flags)
    // deployChe(flags)
  }
}

async function preFlightChecks() {
  await checkPrerequisites()
  await checkMinikubeStatus()
}

async function checkPrerequisites() {
  await checkIfInstalled('minishift')
  await checkIfInstalled('helm')
}

async function checkIfInstalled(commandName: string) {
  let commandExists = require('command-exists')
  await commandExists(commandName, function (_err: any, commandExists: any) {
    if (!commandExists) {
      console.error('ERROR: minikube is not installed.')
      process.exit(-1)
    }
    console.log(`${commandName} is installed`)
  })
}

async function checkMinikubeStatus() {
  await exec('minikube status', (err: any, stdout: any, _stderr: any) => {
    if (!isNull(err)) {
      console.error('ERROR: command \'minikube status\' failed')
      console.error(`${stdout}`)
      process.exit(-1)
    }

    if (!stdout.includes('Running')) {
      console.error('ERROR: command \'minikube status\' reports that minikube is not running')
      console.error(`stdout: ${stdout}`)
      process.exit(-1)
    }
    console.log('Minikube is running')
  })
}

async function configureMinikube() {
  await exec('minikube addons enable ingress', (err: any, stdout: any, _stderr: any) => {
    if (!isNull(err)) {
      console.error('ERROR: command \'minikube addons enable ingress\' failed')
      console.error(`${stdout}`)
      process.exit(-1)
    }
    console.log('Minikube ingress addon enabled successfully')
  })

  await exec('kubectl get clusterrolebinding add-on-cluster-admin', async (err: any, _stdout: any, _stderr: any) => {
    if (isNull(err)) {
      console.log("RoleBinding \'add-on-cluster-admin\' already exists, no need to create it")
    } else {
      await exec('kubectl create clusterrolebinding add-on-cluster-admin --clusterrole=cluster-admin --serviceaccount=kube-system:default', (err: any, stdout: any, _stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create clusterrolebinding add-on-cluster-admin\' failed')
          console.error(`${stdout}`)
          process.exit(-1)
        }
        console.log("RoleBinding \'add-on-cluster-admin\' created successfully")
      })
    }
  })
}

async function installHelm(flags: any) {
  await exec('kubectl get serviceaccounts tiller --namespace kube-system', async (err: any, _stdout: any, _stderr: any) => {
    if (isNull(err)) {
      console.log("Service account \'tiller\' already exists, no need to create it")
    } else {
      await exec('kubectl create serviceaccount tiller --namespace kube-system', async (err: any, stdout: any, _stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create serviceaccount tiller --namespace kube-system\' failed')
          console.error(`${stdout}`)
          process.exit(-1)
        }
        console.log("Service account \'tiller\' created successfully")
        let wait = ms => new Promise((r, _j) => setTimeout(r, ms))
        await wait(1000)
      })
    }
  })

  await exec(`kubectl apply -f ${flags.chepath}/deploy/kubernetes/helm/che/tiller-rbac.yaml`, (err: any, stdout: any, _stderr: any) => {
    if (!isNull(err)) {
      console.error(`ERROR: command 'kubectl apply -f ${flags.chepath}/deploy/kubernetes/helm/che/tiller-rbac.yaml' failed`)
      console.error(`${stdout}`)
      process.exit(-1)
    }
    console.log('Tiller RBAC created successfully')
  })

  await exec('kubectl get services tiller-deploy -n kube-system', async (err: any, _stdout: any, _stderr: any) => {
    if (isNull(err)) {
      console.log('Tiller service already exists, no need to deploy it')
    } else {
      await exec('helm init --service-account tiller', (err: any, stdout: any, _stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create serviceaccount tiller --namespace kube-system\' failed')
          console.error(`${stdout}`)
          process.exit(-1)
        }
        console.log('Tiller has been deployed successfully')
      })
    }
  })
}

function deployChe(flags: any) {
  let command = `helm upgrade \
\n--install che \
\n--namespace ${flags.chenamespace} \
\n--set global.ingressDomain=$(minikube ip).nip.io \
\n--set cheImage=eclipse/che-server:nightly \
\n--set global.cheWorkspacesNamespace= ${flags.chenamespace} \
\n ${flags.chepath}/deploy/kubernetes/helm/che/`

  exec(command, (err: any, stdout: any, _stderr: any) => {
    if (isNull(err)) {
      console.log("Command 'helm upgrade' executed successfully")
      console.log(stdout)
    } else {
      console.error("ERROR: command 'helm upgrade' failed")
      console.error(`${stdout}`)
      process.exit(-1)
    }
  })
}
