import {Command, flags} from '@oclif/command'
import {commandExists} from 'command-exists'
import { isNull } from 'util';
import { string } from '@oclif/parser/lib/flags';

export default class Run extends Command {
  static description = 'Run Eclipse Che'

  static flags = {
    help: flags.help({char: 'h'}),
    "che-local-git-repository": flags.string({
      char: 'r',
      description: 'path to Che local git repository',
      default: '~/github/che',
      env: 'CHE_LOCAL_GIT_REPO'}),
    force: flags.boolean({char: 'f'}),
  }

  static args = [{name: 'file'}]

  async run() {
    const {args, flags} = this.parse(Run)

    preFlightChecks();
    configureMinikube();

  }
}

function preFlightChecks() {
  checkPrerequisites();
  checkStatus();
}

function checkPrerequisites() {
  var commandExists = require('command-exists');
  commandExists('minikube', function (err: any, commandExists: any) {
    if (!commandExists) {
      console.error('ERROR: minikube is not installed.');
      return -1;
    }
    console.log("Minikube is installed");
  });
  commandExists('helm', function (err: any, commandExists: any) {
    if (!commandExists) {
      console.error('ERROR: helm is not installed.');
      return -1;
    }
    console.log("Helm is installed");
  });
}

function checkStatus() {
  const { exec } = require('child_process');
  exec('minikube status', (err: any, stdout: any, stderr: any) => {
    if (!isNull(err)) {
      console.error('ERROR: command \'minikube status\' failed');
      console.error(`${stdout}`);
      return -1;
    }

    if (!stdout.includes("Running")) {
      console.error('ERROR: command \'minikube status\' failed');
      console.error(`stdout: ${stdout}`);
      return -1;
    }
    console.log("Minikube is running");
  });
}

const { exec } = require('child_process');

function configureMinikube() {
  exec('minikube addons enable ingress', (err: any, stdout: any, stderr: any) => {
    if (!isNull(err)) {
      console.error('ERROR: command \'minikube addons enable ingress\' failed');
      console.error(`${stdout}`);
      return -1;
    }
    console.log("Ingress Addon Enabled Successfully");
  });

  exec('kubectl get clusterrolebinding add-on-cluster-admin', (err: any, stdout: any, stderr: any) => {
    if (isNull(err)) {
      console.log("RoleBinding \'add-on-cluster-admin\' already exists, no need to create it");
    } else {
      exec('kubectl create clusterrolebinding add-on-cluster-admin --clusterrole=cluster-admin --serviceaccount=kube-system:default', (err: any, stdout: any, stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create clusterrolebinding add-on-cluster-admin\' failed');
          console.error(`${stdout}`);
          return -1;
        }
        console.log("RoleBinding \'add-on-cluster-admin\' created successfully");
      });
    }
  });
}

function installHelm(){
  exec('kubectl get serviceaccounts tiller --namespace kube-system', (err: any, stdout: any, stderr: any) => {
    if (isNull(err)) {
      console.log("Service account \'tiller\' already exists, no need to create it");
    } else {
      exec('kubectl create serviceaccount tiller --namespace kube-system', (err: any, stdout: any, stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create serviceaccount tiller --namespace kube-system\' failed');
          console.error(`${stdout}`);
          return -1;
        }
        console.log("Service account \'tiller\' created successfully");
      });
    }
  });

  exec('kubectl apply -f ${ flags."che-local-git-repository" }/deploy/kubernetes/helm/che/tiller-rbac.yaml', (err: any, stdout: any, stderr: any) => {
    if (!isNull(err)) {
      console.error('ERROR: command \'kubectl apply -f ${ flags."che-local-git-repository" }/deploy/kubernetes/helm/che/tiller-rbac.yaml\' failed');
      console.error(`${stdout}`);
      return -1;
    }
    console.log("Tiller RBAC created successfully");
  });

  exec('kubectl get services tiller-deploy -n kube-system', (err: any, stdout: any, stderr: any) => {
    if (isNull(err)) {
      console.log("Tiller service already exists, no need to deploy it");
    } else {
      exec('helm init --service-account tiller', (err: any, stdout: any, stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create serviceaccount tiller --namespace kube-system\' failed');
          console.error(`${stdout}`);
          return -1;
        }
        console.log("Tiller has been deployed successfully");
      });
    }
  });
}

function deployChe(){
  let command: string = "helm upgrade \
\n--install che \
\n--namespace ${ flags. } \
\n--set global.ingressDomain=$(minikube ip).nip.io \
\n--set cheImage=eclipse/che-server:nightly \
\n--set global.cheWorkspacesNamespace=${CHE_NAMESPACE} \
\n${CHE_LOCAL_GIT_REPO}/deploy/kubernetes/helm/che/"

  exec(command, (err: any, stdout: any, stderr: any) => {
    if (isNull(err)) {
      console.log("Service account \'tiller\' already exists, no need to create it");
    } else {
      exec('kubectl create serviceaccount tiller --namespace kube-system', (err: any, stdout: any, stderr: any) => {
        if (isNull(err)) {
          console.error('ERROR: command \'kubectl create serviceaccount tiller --namespace kube-system\' failed');
          console.error(`${stdout}`);
          return -1;
        }
        console.log("Service account \'tiller\' created successfully");
      });
    }
  });
}

