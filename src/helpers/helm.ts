// tslint:disable:object-curly-spacing

import cli from 'cli-ux'
import * as execa from 'execa'
import * as fs from 'fs'
import * as path from 'path'

export class HelmHelper {
  async tillerRoleBindingExist(): Promise<boolean> {
    const { code } = await execa('kubectl', ['get', 'clusterrolebinding', 'add-on-cluster-admin'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async createTillerRoleBinding() {
    await execa('kubectl', ['create', 'clusterrolebinding', 'add-on-cluster-admin', '--clusterrole=cluster-admin', '--serviceaccount=kube-system:default'], { timeout: 10000})
  }

  async tillerServiceAccountExist(): Promise<boolean> {
    const { code } = await execa('kubectl', ['get', 'serviceaccounts', 'tiller', '--namespace', 'kube-system'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async createTillerServiceAccount() {
    await execa('kubectl', ['create', 'serviceaccount', 'tiller', '--namespace', 'kube-system'], { timeout: 10000})
  }

  async createTillerRBAC(templatesPath: any) {
    const yamlPath = path.join(templatesPath, '/kubernetes/helm/che/tiller-rbac.yaml')
    const yamlContent = fs.readFileSync(yamlPath, 'utf8')
    const command = `echo "${yamlContent}" | \\
                    kubectl apply -f -`
    await execa.shell(command, { timeout: 10000 })
  }

  async tillerServiceExist(): Promise<boolean> {
    const { code } = await execa('kubectl', ['get', 'services', 'tiller-deploy', '-n', 'kube-system'], { timeout: 10000, reject: false})
    if (code === 0) { return true } else { return false }
  }

  async createTillerService() {
    await execa('helm', ['init', '--service-account', 'tiller'], { timeout: 10000 })
    await cli.wait(10000)
  }

}
