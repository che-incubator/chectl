/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import * as execa from 'execa'
import * as os from 'os'
import * as path from 'path'

import { KubeConfig } from '@kubernetes/client-node'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'

import { CheHelper } from '../../api/che'

export default class Inject extends Command {
  static description = 'inject configurations and tokens in a Che Workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    kubeconfig: flags.boolean({
      char: 'k',
      description: 'Inject the local Kubernetes configuration'
    }),
    workspace: string({
      char: 'w',
      description: 'Target workspace'
    }),
    container: string({
      char: 'c',
      description: 'Target container',
      default: 'dev'
    }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che workspace is running',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
    'listr-renderer': string({
      description: 'Listr renderer. Can be \'default\', \'silent\' or \'verbose\'',
      default: 'default'
    }),
  }

  async run() {
    const { flags } = this.parse(Inject)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper()
    const tasks = new Listr([
      {
        title: `Verify if namespace ${flags.chenamespace} exists`,
        task: async () => {
          if (!await che.cheNamespaceExist(flags.chenamespace)) {
            this.error(`E_BAD_NS - Namespace does not exist.\nThe Kubernetes Namespace "${flags.chenamespace}" doesn't exist. The Kubernetes configuration cannot be injected.\nFix with: verify the namespace where Che workspace is running (kubectl get --all-namespaces deployment | grep workspace)`, {code: 'EBADNS'})
          }
        }
      },
      {
        title: 'Verify if the workspaces is running',
        task: async (ctx: any) => {
          ctx.pod = await che.getWorkspacePod(flags.chenamespace!, flags.workspace).catch(e => this.error(e.message))
        }
      },
      {
        title: `Verify if container ${flags.container} exists`,
        task: async (ctx: any) => {
          if (!await this.containerExists(flags.chenamespace!, ctx.pod, flags.container!)) {
            this.error(`The container "${flags.container}" doesn't exist. The Kubernetes configuration cannot be injected.`)
          }
        }
      },
      {
        title: 'Injecting Kubernetes configuration',
        skip: () => {
          if (!flags.kubeconfig) {
            return 'Currently, injecting only the local kubeconfig is supported. Please, specify flag -k'
          }
        },
        task: (ctx: any, task: any) => this.injectKubeconfig(flags.chenamespace!, ctx.pod, flags.container!).then(result => {
          if (!result) {
            task.skip('kubeconfig already exists in the target container')
          }
        }).catch(e => this.error(e.message)) },
    ], {renderer: flags['listr-renderer'] as any})

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: `Command ${this.id} has completed.`
    })
  }

  /**
   * Copies the local kubeconfig (only minikube context) in a Che Workspace.
   * Returns true if file is injected successfully and false otherwise.
   */
  async injectKubeconfig(cheNamespace: string, workspacePod: string, container: string): Promise<boolean> {
    const { stdout } = await execa.shell(`kubectl exec ${workspacePod} -n ${cheNamespace} -c ${container} env | grep ^HOME=`, { timeout: 10000 })
    const containerHomeDir = stdout.split('=')[1]

    if (await this.fileExists(cheNamespace, workspacePod, container, `${containerHomeDir}/.kube/config`)) {
      return false
    }
    await execa.shell(`kubectl exec ${workspacePod} -n ${cheNamespace} -c ${container} -- mkdir ${containerHomeDir}/.kube -p`, { timeout: 10000 })

    const kc = new KubeConfig()
    kc.loadFromDefault()
    const contextName = 'minikube'
    const contextToInject = kc.getContexts().find(c => c.name === contextName)
    if (!contextToInject) {
      throw new Error(`Context ${contextName} is not found in the local kubeconfig`)
    }
    const kubeconfig = path.join(os.tmpdir(), 'che-kubeconfig')
    const cluster = kc.getCluster(contextToInject.cluster)
    const user = kc.getUser(contextToInject.user)
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-cluster', cluster.name, `--server=${cluster.server}`, `--certificate-authority=${cluster.caFile}`, '--embed-certs=true'], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-credentials', user.name, `--client-certificate=${user.certFile}`, `--client-key=${user.keyFile}`, '--embed-certs=true'], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-context', contextToInject.name, `--cluster=${contextToInject.cluster}`, `--user=${contextToInject.user}`, `--namespace=${cheNamespace}`], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'use-context', contextToInject.name], { timeout: 10000 })
    await execa('kubectl', ['cp', kubeconfig, `${cheNamespace}/${workspacePod}:${containerHomeDir}/.kube/config`, '-c', container], { timeout: 10000 })
    return true
  }

  async fileExists(namespace: string, pod: string, container: string, file: string): Promise<boolean> {
    const { code } = await execa.shell(`kubectl exec ${pod} -n ${namespace} -c ${container} -- test -e ${file}`, { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async containerExists(namespace: string, pod: string, container: string): Promise<boolean> {
    const { stdout } = await execa('kubectl', ['get', 'pods', `${pod}`, '-n', `${namespace}`, '-o', 'jsonpath={.spec.containers[*].name}'], { timeout: 10000 })
    return stdout.split(' ').some(c => c === container)
  }
}
