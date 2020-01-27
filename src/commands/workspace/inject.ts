/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { KubeConfig } from '@kubernetes/client-node'
import { Context } from '@kubernetes/client-node/dist/config_types'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'
import * as Listr from 'listr'
import * as os from 'os'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'

export default class Inject extends Command {
  static description = 'inject configurations and tokens in a workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    kubeconfig: flags.boolean({
      char: 'k',
      description: 'Inject the local Kubernetes configuration'
    }),
    workspace: string({
      char: 'w',
      description: 'Target workspace. Can be omitted if only one Workspace is running'
    }),
    container: string({
      char: 'c',
      description: 'Target container. If not specified, configuration files will be injected in all containers of a workspace pod',
      required: false
    }),
    'kube-context': string({
      description: 'Kubeconfig context to inject',
      required: false
    }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Inject)
    const notifier = require('node-notifier')
    const cheTasks = new CheTasks(flags)

    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.verifyWorkspaceRunTask(flags, this))
    tasks.add([
      {
        title: `Verify if container ${flags.container} exists`,
        enabled: () => flags.container !== undefined,
        task: async (ctx: any) => {
          if (!await this.containerExists(flags.chenamespace!, ctx.pod, flags.container!)) {
            this.error(`The specified container "${flags.container}" doesn't exist. The configuration cannot be injected.`)
          }
        }
      },
      {
        title: 'Injecting configurations',
        skip: () => {
          if (!flags.kubeconfig) {
            return 'Currently, only injecting a kubeconfig is supported. Please, specify flag -k'
          }
        },
        task: () => this.injectKubeconfigTasks(flags)
      },
    ])

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

  async injectKubeconfigTasks(flags: any): Promise<Listr> {
    const kubeContext = flags['kube-context']
    let contextToInject: Context | null
    const kh = new KubeHelper(flags)
    if (kubeContext) {
      contextToInject = kh.getContext(kubeContext)
      if (!contextToInject) {
        this.error(`Context ${kubeContext} is not found in the source kubeconfig`)
      }
    } else {
      const currentContext = await kh.currentContext()
      contextToInject = kh.getContext(currentContext)
    }

    const che = new CheHelper(flags)
    const tasks = new Listr({ exitOnError: false, concurrent: true })
    const containers = flags.container ? [flags.container] : await che.getWorkspacePodContainers(flags.chenamespace!, flags.workspace!)
    for (const cont of containers) {
      // che-machine-exec container is very limited for a security reason.
      // We cannot copy file into it.
      if (cont === 'che-machine-exec') {
        continue
      }
      tasks.add({
        title: `injecting kubeconfig into container ${cont}`,
        task: async (ctx: any, task: any) => {
          try {
            if (await this.canInject(flags.chenamespace, ctx.pod, cont)) {
              await this.injectKubeconfig(flags.chenamespace!, ctx.pod, cont, contextToInject!)
              task.title = `${task.title}...done.`
            } else {
              task.skip('the container doesn\'t support file injection')
            }
          } catch (error) {
            task.skip(error.message)
          }
        }
      })
    }
    return tasks
  }

  /**
   * Tests whether a file can be injected into the specified container.
   */
  async canInject(namespace: string, pod: string, container: string): Promise<boolean> {
    const { exitCode } = await execa(`kubectl exec ${pod} -n ${namespace} -c ${container} -- tar --version `, { timeout: 10000, reject: false, shell: true })
    if (exitCode === 0) { return true } else { return false }
  }

  /**
   * Copies the local kubeconfig into the specified container.
   * If returns, it means injection was completed successfully. If throws an error, injection failed
   */
  async injectKubeconfig(cheNamespace: string, workspacePod: string, container: string, contextToInject: Context): Promise<void> {
    const { stdout } = await execa(`kubectl exec ${workspacePod} -n ${cheNamespace} -c ${container} env | grep ^HOME=`, { timeout: 10000, shell: true })
    let containerHomeDir = stdout.split('=')[1]
    if (!containerHomeDir.endsWith('/')) {
      containerHomeDir += '/'
    }

    if (await this.fileExists(cheNamespace, workspacePod, container, `${containerHomeDir}.kube/config`)) {
      throw new Error('kubeconfig already exists in the target container')
    }
    await execa(`kubectl exec ${workspacePod} -n ${cheNamespace} -c ${container} -- mkdir ${containerHomeDir}.kube -p`, { timeout: 10000, shell: true })

    const kc = new KubeConfig()
    kc.loadFromDefault()
    const kubeconfig = path.join(os.tmpdir(), 'che-kubeconfig')
    const cluster = kc.getCluster(contextToInject.cluster)
    if (!cluster) {
      throw new Error(`Context ${contextToInject.name} has no cluster object`)
    }
    const user = kc.getUser(contextToInject.user)
    if (!user) {
      throw new Error(`Context ${contextToInject.name} has no user object`)
    }
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-cluster', cluster.name, `--server=${cluster.server}`, `--certificate-authority=${cluster.caFile}`, '--embed-certs=true'], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-credentials', user.name, `--client-certificate=${user.certFile}`, `--client-key=${user.keyFile}`, '--embed-certs=true'], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'set-context', contextToInject.name, `--cluster=${contextToInject.cluster}`, `--user=${contextToInject.user}`, `--namespace=${cheNamespace}`], { timeout: 10000 })
    await execa('kubectl', ['config', '--kubeconfig', kubeconfig, 'use-context', contextToInject.name], { timeout: 10000 })
    await execa('kubectl', ['cp', kubeconfig, `${cheNamespace}/${workspacePod}:${containerHomeDir}.kube/config`, '-c', container], { timeout: 10000 })
    return
  }

  async fileExists(namespace: string, pod: string, container: string, file: string): Promise<boolean> {
    const { exitCode } = await execa(`kubectl exec ${pod} -n ${namespace} -c ${container} -- test -e ${file}`, { timeout: 10000, reject: false, shell: true })
    if (exitCode === 0) { return true } else { return false }
  }

  async containerExists(namespace: string, pod: string, container: string): Promise<boolean> {
    const { stdout } = await execa('kubectl', ['get', 'pods', `${pod}`, '-n', `${namespace}`, '-o', 'jsonpath={.spec.containers[*].name}'], { timeout: 10000 })
    return stdout.split(' ').some(c => c === container)
  }
}
