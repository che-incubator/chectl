/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as fs from 'fs'
import { copy, mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { CHE_TLS_SECRET_NAME } from '../../constants'
import { CertManagerTasks } from '../../tasks/component-installers/cert-manager'

export class HelmTasks {
  protected kubeHelper: KubeHelper

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    command.warn('You can also use features rich \'OLM\' installer to deploy Eclipse Che.')
    return new Listr([
      {
        title: 'Verify if helm is installed',
        task: () => { if (!commandExists.sync('helm')) { command.error('E_REQUISITE_NOT_FOUND') } }
      },
      {
        title: 'Check Helm Version',
        task: async (ctx: any, task: any) => {
          try {
            const version = await this.getVersion()
            ctx.isHelmV3 = version.startsWith('v3.')

            if (!flags['skip-version-check']) {
              const checkPassed = VersionHelper.checkMinimalHelmVersion(version)
              if (!checkPassed) {
                throw VersionHelper.getError(version, VersionHelper.MINIMAL_HELM_VERSION, 'helm')
              }
            }

            task.title = `${task.title}: Found ${version}`
          } catch (error) {
            command.error(`Unable to get helm version. ${error.message}`)
          }
        }
      },
      {
        title: `Create Namespace (${flags.chenamespace})`,
        task: async (_ctx: any, task: any) => {
          const che = new CheHelper(flags)
          const exist = await che.cheNamespaceExist(flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...does already exist.`
          } else {
            await execa(`kubectl create namespace ${flags.chenamespace}`, { shell: true })
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Check Eclipse Che TLS certificate',
        task: async (ctx: any, task: any) => {
          const cheTlsSecret = await this.kubeHelper.getSecret(CHE_TLS_SECRET_NAME, flags.chenamespace)

          if (cheTlsSecret && cheTlsSecret.data) {
            if (!cheTlsSecret.data['tls.crt'] || !cheTlsSecret.data['tls.key'] || !cheTlsSecret.data['ca.crt']) {
              throw new Error('"che-tls" secret is found but it is invalid. The valid self-signed certificate should contain "tls.crt", "tls.key" and "ca.crt" entries.')
            }

            ctx.cheCertificateExists = true

            task.title = `${task.title}...self-signed certificate secret found`
          } else {
            // TLS certificate for Eclipse Che hasn't been added into the cluster manually, so we need to take care about it automatically
            ctx.cheCertificateExists = false
            // Set self-signed certificate flag to true as we are going to generate one
            flags['self-signed-cert'] = true

            task.title = `${task.title}...going to generate self-signed one`

            const certManagerTasks = new CertManagerTasks(flags)
            return new Listr(certManagerTasks.getTasks(flags), ctx.listrOptions)
          }
        }
      },
      {
        title: 'Create Tiller Role Binding',
        // Tiller is not used anymore in helm v3
        enabled: (ctx: any) => !ctx.isHelmV3,
        task: async (_ctx: any, task: any) => {
          const roleBindingExist = await this.tillerRoleBindingExist()
          if (roleBindingExist) {
            task.title = `${task.title}...it already exists.`
          } else {
            await this.createTillerRoleBinding()
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Check Cluster Role Binding',
        // For helm v3 check for cluster role and delete it if exists
        enabled: (ctx: any) => ctx.isHelmV3,
        task: async (_ctx: any, task: any) => {
          const roleBindingExist = await this.clusterRoleBindingExist(flags.chenamespace)
          if (!roleBindingExist) {
            task.title = `${task.title}...does not exists.`
          } else {
            await this.removeClusterRoleBinding(flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Create Tiller Service Account',
        // Tiller is not used anymore in helm v3
        enabled: (ctx: any) => !ctx.isHelmV3,
        task: async (_ctx: any, task: any) => {
          const tillerServiceAccountExist = await this.tillerServiceAccountExist()
          if (tillerServiceAccountExist) {
            task.title = `${task.title}...it already exists.`
          } else {
            await this.createTillerServiceAccount()
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Create Tiller RBAC',
        // Tiller is not used anymore in helm v3
        enabled: (ctx: any) => !ctx.isHelmV3,
        task: async () => this.createTillerRBAC(flags.templates)
      },
      {
        // Tiller is not used anymore in helm v3
        enabled: (ctx: any) => !ctx.isHelmV3,
        title: 'Create Tiller Service',
        task: async (_ctx: any, task: any) => {
          const tillerServiceExist = await this.tillerServiceExist()
          if (tillerServiceExist) {
            task.title = `${task.title}...it already exists.`
          } else {
            await this.createTillerService()
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: 'Preparing Eclipse Che Helm Chart',
        task: async (_ctx: any, task: any) => {
          await this.prepareCheHelmChart(flags, command.config.cacheDir)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Updating Helm Chart dependencies',
        task: async (_ctx: any, task: any) => {
          await this.updateCheHelmChartDependencies(command.config.cacheDir)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Deploying Eclipse Che Helm Chart',
        task: async (ctx: any, task: any) => {
          await this.upgradeCheHelmChart(ctx, flags, command.config.cacheDir)
          task.title = `${task.title}...done.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  /**
   * Returns list of tasks which remove helm chart
   */
  deleteTasks(_flags: any): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: 'Purge Eclipse Che Helm chart',
      enabled: (ctx: any) => !ctx.isOpenShift,
      task: async (_ctx: any, task: any) => {
        if (await !commandExists.sync('helm')) {
          task.title = await `${task.title}...OK (Helm not found)`
        } else {
          await this.purgeHelmChart('che')
          task.title = await `${task.title}...OK`
        }
      }
    }]
  }

  async clusterRoleBindingExist(cheNamespace: string, execTimeout = 30000): Promise<boolean> {
    const { exitCode } = await execa('kubectl', ['get', 'clusterrolebinding', `${cheNamespace}-che-clusterrole-binding`], { timeout: execTimeout, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async removeClusterRoleBinding(cheNamespace: string, execTimeout = 30000): Promise<boolean> {
    const { exitCode } = await execa('kubectl', ['delete', 'clusterrolebinding', `${cheNamespace}-che-clusterrole-binding`], { timeout: execTimeout, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async tillerRoleBindingExist(execTimeout = 30000): Promise<boolean> {
    const { exitCode } = await execa('kubectl', ['get', 'clusterrolebinding', 'add-on-cluster-admin'], { timeout: execTimeout, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async createTillerRoleBinding(execTimeout = 30000) {
    await execa('kubectl', ['create', 'clusterrolebinding', 'add-on-cluster-admin', '--clusterrole=cluster-admin', '--serviceaccount=kube-system:default'], { timeout: execTimeout })
  }

  async tillerServiceAccountExist(execTimeout = 30000): Promise<boolean> {
    const { exitCode } = await execa('kubectl', ['get', 'serviceaccounts', 'tiller', '--namespace', 'kube-system'], { timeout: execTimeout, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async createTillerServiceAccount(execTimeout = 120000) {
    await execa('kubectl', ['create', 'serviceaccount', 'tiller', '--namespace', 'kube-system'], { timeout: execTimeout })
  }

  async createTillerRBAC(templatesPath: any, execTimeout = 30000) {
    const yamlPath = path.join(templatesPath, '/kubernetes/helm/che/tiller-rbac.yaml')
    const yamlContent = fs.readFileSync(yamlPath, 'utf8')
    const command = `echo "${yamlContent}" | kubectl apply -f -`
    await execa(command, { timeout: execTimeout, shell: true })
  }

  async tillerServiceExist(execTimeout = 30000): Promise<boolean> {
    const { exitCode } = await execa('kubectl', ['get', 'services', 'tiller-deploy', '-n', 'kube-system'], { timeout: execTimeout, reject: false })
    if (exitCode === 0) { return true } else { return false }
  }

  async getVersion(execTimeout = 10000): Promise<string> {
    let { stdout, exitCode } = await execa('helm', ['version', '-c', '--short'], { timeout: execTimeout, reject: false })
    const CLIENT_PREFIX = 'Client: '
    if (stdout.startsWith(CLIENT_PREFIX)) {
      stdout = stdout.substring(CLIENT_PREFIX.length)
    }
    if (exitCode === 0) { return stdout }
    throw new Error('Unable to get version')
  }

  async createTillerService(execTimeout = 120000) {
    const { command, exitCode, stderr, stdout, timedOut } =
      await execa('helm', ['init', '--service-account', 'tiller', '--wait'], { timeout: execTimeout, reject: false })
    if (timedOut) {
      throw new Error(`Command "${command}" timed out after ${execTimeout}ms
stderr: ${stderr}
stdout: ${stdout}
error: E_TIMEOUT`)
    }
    if (exitCode !== 0) {
      throw new Error(`Command "${command}" failed with return code ${exitCode}
stderr: ${stderr}
stdout: ${stdout}
error: E_COMMAND_FAILED`)
    }
  }

  async purgeHelmChart(name: string, execTimeout = 30000) {
    await execa('helm', ['delete', name, '--purge'], { timeout: execTimeout, reject: false })
  }

  private async prepareCheHelmChart(flags: any, cacheDir: string) {
    const srcDir = path.join(flags.templates, '/kubernetes/helm/che/')
    const destDir = path.join(cacheDir, '/templates/kubernetes/helm/che/')
    await remove(destDir)
    await mkdirp(destDir)
    await copy(srcDir, destDir)
  }

  private async updateCheHelmChartDependencies(cacheDir: string, execTimeout = 120000) {
    const destDir = path.join(cacheDir, '/templates/kubernetes/helm/che/')
    await execa(`helm dependencies update --skip-refresh ${destDir}`, { timeout: execTimeout, shell: true })
  }

  private async upgradeCheHelmChart(ctx: any, flags: any, cacheDir: string, execTimeout = 120000) {
    const destDir = path.join(cacheDir, '/templates/kubernetes/helm/che/')

    let multiUserFlag = ''
    let tlsFlag = ''
    let setOptions = []

    ctx.isCheDeployed = true
    if (flags.multiuser) {
      ctx.isPostgresDeployed = true
      ctx.isKeaycloakDeployed = true
      multiUserFlag = `-f ${destDir}values/multi-user.yaml`
    }

    if (flags.tls) {
      setOptions.push(`--set global.cheDomain=${flags.domain}`)
      tlsFlag = `-f ${destDir}values/tls.yaml`
    }

    if (flags['self-signed-cert']) {
      setOptions.push('--set global.tls.useSelfSignedCerts=true')
    }

    if (flags['plugin-registry-url']) {
      setOptions.push(`--set che.workspace.pluginRegistryUrl=${flags['plugin-registry-url']} --set chePluginRegistry.deploy=false`)
    } else {
      ctx.isPluginRegistryDeployed = true
    }

    if (flags['devfile-registry-url']) {
      setOptions.push(`--set che.workspace.devfileRegistryUrl=${flags['devfile-registry-url']} --set cheDevfileRegistry.deploy=false`)
    } else {
      ctx.isDevfileRegistryDeployed = true
    }

    if (flags['workspace-pvc-storage-class-name']) {
      setOptions.push(`--set global.cheWorkspacePVCStorageClassName=${flags['workspace-pvc-storage-class-name']}`)
    }

    if (flags['postgres-pvc-storage-class-name']) {
      setOptions.push(`--set global.chePostgresPVCStorageClassName=${flags['postgres-pvc-storage-class-name']}`)
    }

    setOptions.push(`--set global.ingressDomain=${flags.domain}`)
    setOptions.push(`--set cheImage=${flags.cheimage}`)
    setOptions.push(`--set che.disableProbes=${flags.debug}`)

    let command = `helm upgrade --install che --force --namespace ${flags.chenamespace} ${setOptions.join(' ')} ${multiUserFlag} ${tlsFlag} ${destDir}`

    let { exitCode, stderr } = await execa(command, { timeout: execTimeout, reject: false, shell: true })
    // if process failed, check the following
    // if revision=1, purge and retry command else rollback
    if (exitCode !== 0) {
      // get revision

      const { exitCode, stdout } = await execa(`helm history ${flags.chenamespace} --output json`, { timeout: execTimeout, reject: false, shell: true })
      if (exitCode !== 0) {
        throw new Error(`Unable to execute helm command ${command} / ${stderr}`)
      }
      let jsonOutput
      try {
        jsonOutput = JSON.parse(stdout)
      } catch (err) {
        throw new Error('Unable to grab helm history:' + err)
      }
      const revision = jsonOutput[0].revision
      if (jsonOutput.length > 0 && revision === '1') {
        await this.purgeHelmChart(flags.chenamespace)
      } else {
        await execa('helm', ['rollback', flags.chenamespace, revision], { timeout: execTimeout })

      }
      await execa(command, { timeout: execTimeout, shell: true })

    }
  }

}
