/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { Context } from '@kubernetes/client-node/dist/config_types'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as execa from 'execa'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { getLoginData } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { getClusterClientCommand, OPENSHIFT_CLI, wrapCommandError } from '../../util'

export default class Inject extends Command {
  static description = 'Inject configurations and tokens in a workspace'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    kubeconfig: flags.boolean({
      char: 'k',
      description: 'Inject the local Kubernetes configuration',
      required: true,
    }),
    workspace: string({
      char: 'w',
      description: `The workspace id to inject configuration into. It can be omitted if the only one running workspace exists.
                    Use workspace:list command to get all workspaces and their statuses.`,
    }),
    container: string({
      char: 'c',
      description: 'The container name. If not specified, configuration files will be injected in all containers of the workspace pod',
      required: false,
    }),
    'kube-context': string({
      description: 'Kubeconfig context to inject',
      required: false,
    }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    chenamespace: cheNamespace,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY,
  }

  // Holds cluster CLI tool name: kubectl or oc
  private readonly command = getClusterClientCommand()

  async run() {
    const { flags } = this.parse(Inject)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Inject.id, flags })

    const cheHelper = new CheHelper(flags)

    const { cheApiEndpoint, accessToken } = await getLoginData(flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY], flags)
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)

    let workspaceId = flags.workspace
    let workspaceNamespace = ''
    if (!workspaceId) {
      const workspaces = await cheApiClient.getAllWorkspaces(accessToken)
      const runningWorkspaces = workspaces.filter(w => w.status === 'RUNNING')
      if (runningWorkspaces.length === 1) {
        workspaceId = runningWorkspaces[0].id
        workspaceNamespace = runningWorkspaces[0].attributes!.infrastructureNamespace
      } else if (runningWorkspaces.length === 0) {
        cli.error('There are no running workspaces. Please start workspace first.')
      } else {
        cli.error('There are more than 1 running workspaces. Please, specify the workspace id by providing \'--workspace\' flag.\nSee more details with the --help flag.')
      }
    } else {
      const workspace = await cheApiClient.getWorkspaceById(workspaceId, accessToken)
      if (workspace.status !== 'RUNNING') {
        cli.error(`Workspace '${workspaceId}' is not running. Please start workspace first.`)
      }
      workspaceNamespace = workspace.attributes!.infrastructureNamespace
    }

    const workspacePodName = await cheHelper.getWorkspacePodName(workspaceNamespace, workspaceId!)
    if (flags.container && !await this.containerExists(workspaceNamespace, workspacePodName, flags.container)) {
      cli.error(`The specified container '${flags.container}' doesn't exist. The configuration cannot be injected.`)
    }

    try {
      await this.injectKubeconfig(flags, workspaceNamespace, workspacePodName, workspaceId!)
    } catch (err) {
      this.error(wrapCommandError(err))
    }
  }

  async injectKubeconfig(flags: any, workspaceNamespace: string, workspacePodName: string, workspaceId: string): Promise<void> {
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
    const containers = flags.container ? [flags.container] : await che.getWorkspacePodContainers(workspaceNamespace, workspaceId)
    for (const container of containers) {
      // che-machine-exec container is very limited for a security reason.
      // We cannot copy file into it.
      if (container.startsWith('che-machine-exec') || container.startsWith('che-jwtproxy')) {
        continue
      }

      try {
        if (await this.canInject(workspaceNamespace, workspacePodName, container)) {
          await this.doInjectKubeconfig(workspaceNamespace, workspacePodName, container, contextToInject!)
          cli.info(`Configuration successfully injected into ${container} container`)
        }
      } catch (error) {
        cli.warn(`Failed to injected configuration into ${container} container.\nError: ${error.message}`)
      }
    }
  }

  /**
   * Tests whether a file can be injected into the specified container.
   */
  private async canInject(namespace: string, pod: string, container: string): Promise<boolean> {
    const { exitCode } = await execa(`${this.command} exec ${pod} -n ${namespace} -c ${container} -- tar --version `, { timeout: 10000, reject: false, shell: true })
    if (exitCode === 0) {
      return true
    } else {
      return false
    }
  }

  /**
   * Copies the local kubeconfig into the specified container.
   * If returns, it means injection was completed successfully. If throws an error, injection failed
   */
  private async doInjectKubeconfig(namespace: string, workspacePod: string, container: string, contextToInject: Context): Promise<void> {
    const { stdout } = await execa(`${this.command} exec ${workspacePod} -n ${namespace} -c ${container} env | grep ^HOME=`, { timeout: 10000, shell: true })
    const kc = new KubeHelper()
    let containerHomeDir = stdout.split('=')[1]
    if (!containerHomeDir.endsWith('/')) {
      containerHomeDir += '/'
    }

    if (await this.fileExists(namespace, workspacePod, container, `${containerHomeDir}.kube/config`)) {
      throw new Error('kubeconfig already exists in the target container')
    }
    await execa(`${this.command} exec ${workspacePod} -n ${namespace} -c ${container} -- mkdir ${containerHomeDir}.kube -p`, { timeout: 10000, shell: true })

    const kubeConfigPath = path.join(os.tmpdir(), 'che-kubeconfig')
    const cluster = kc.kubeConfig.getCluster(contextToInject.cluster)
    if (!cluster) {
      throw new Error(`Context ${contextToInject.name} has no cluster object`)
    }
    const user = kc.kubeConfig.getUser(contextToInject.user)
    if (!user) {
      throw new Error(`Context ${contextToInject.name} has no user object`)
    }

    // Despite oc has --kubeconfig flag it actually does nothing, so we need to use --config instead
    const configPathFlag = this.command === OPENSHIFT_CLI ? '--config' : '--kubeconfig'

    const setClusterArgs = ['config', configPathFlag, kubeConfigPath, 'set-cluster', cluster.name, `--server=${cluster.server}`]
    // Prepare CA certificate file
    if (cluster.caFile) {
      setClusterArgs.push(`--certificate-authority=${cluster.caFile}`)
      setClusterArgs.push('--embed-certs=true')
    } else if (cluster.caData) {
      const caFile = path.join(os.tmpdir(), 'cluster-ca-file.pem')
      // Write caData into a file and pass it as the parameter
      fs.writeFileSync(caFile, cluster.caData, 'utf8')

      setClusterArgs.push(`--certificate-authority=${caFile}`)
      setClusterArgs.push('--embed-certs=true')
    }
    await execa(this.command, setClusterArgs, { timeout: 10000 })

    const setCredentialsArgs = ['config', configPathFlag, kubeConfigPath, 'set-credentials', user.name]
    if (user.certFile) {
      setCredentialsArgs.push(`--client-certificate=${user.certFile}`)
    }
    if (user.keyFile) {
      setCredentialsArgs.push(`--client-key=${user.keyFile}`)
    }
    if (user.certFile || user.keyFile) {
      setCredentialsArgs.push('--embed-certs=true')
    }
    await execa(this.command, setCredentialsArgs, { timeout: 10000 })

    await execa(this.command, ['config', configPathFlag, kubeConfigPath, 'set-context', contextToInject.name, `--cluster=${contextToInject.cluster}`, `--user=${contextToInject.user}`, `--namespace=${namespace}`], { timeout: 10000 })
    await execa(this.command, ['config', configPathFlag, kubeConfigPath, 'use-context', contextToInject.name], { timeout: 10000 })

    await execa(this.command, ['cp', kubeConfigPath, `${namespace}/${workspacePod}:${containerHomeDir}.kube/config`, '-c', container], { timeout: 10000 })
    return
  }

  private async fileExists(namespace: string, pod: string, container: string, file: string): Promise<boolean> {
    const { exitCode } = await execa(`${this.command} exec ${pod} -n ${namespace} -c ${container} -- test -e ${file}`, { timeout: 10000, reject: false, shell: true })
    if (exitCode === 0) {
      return true
    } else {
      return false
    }
  }

  private async containerExists(namespace: string, pod: string, container: string): Promise<boolean> {
    const { stdout } = await execa(this.command, ['get', 'pods', `${pod}`, '-n', `${namespace}`, '-o', 'jsonpath={.spec.containers[*].name}'], { timeout: 10000 })
    return stdout.split(' ').some(c => c === container)
  }
}
