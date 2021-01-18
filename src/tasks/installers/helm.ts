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
import * as Listr from 'listr'
import * as path from 'path'

import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { CHE_ROOT_CA_SECRET_NAME, CHE_TLS_SECRET_NAME } from '../../constants'
import { CertManagerTasks } from '../../tasks/component-installers/cert-manager'
import { generatePassword, safeSaveYamlToFile } from '../../util'

interface HelmChartDependency {
  name: string
  repository: string
  version: string
  condition: string
}

export class HelmTasks {
  protected kubeHelper: KubeHelper

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  deployTasks(flags: any, command: Command): Listr {
    if (VersionHelper.isStableVersion(flags)) {
      command.warn('Consider using the more reliable \'OLM\' installer when deploying a stable release of Eclipse Che (--installer=olm).')
    }
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
          const kube = new KubeHelper(flags)
          if (await kube.getNamespace(flags.chenamespace)) {
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
          const fixErrorMessage = 'Helm installer generates secrets automatically. To fix the problem delete existed secrets in dedicated for Eclispe Che namespace and rerun the command.'

          const cheTlsSecret = await this.kubeHelper.getSecret(CHE_TLS_SECRET_NAME, flags.chenamespace)
          if (cheTlsSecret) {
            if (!cheTlsSecret.data || !cheTlsSecret.data['tls.crt'] || !cheTlsSecret.data['tls.key']) {
              throw new Error('"che-tls" secret is found but it is invalid. The valid secret should contain "tls.crt" and "tls.key" entries. ' + fixErrorMessage)
            }
            const selfSignedCertSecret = await this.kubeHelper.getSecret(CHE_ROOT_CA_SECRET_NAME, flags.chenamespace)
            if (selfSignedCertSecret && (!selfSignedCertSecret.data || !selfSignedCertSecret.data['ca.crt'])) {
              throw new Error(`"ca.crt" should be present in ${CHE_ROOT_CA_SECRET_NAME} secret in case of using self-signed certificate with helm installer. ${fixErrorMessage}`)
            }

            ctx.cheCertificateExists = true

            if (selfSignedCertSecret) {
              task.title = `${task.title}...self-signed TLS certificate secret found`
            } else {
              task.title = `${task.title}...TLS certificate secret found`
            }
          } else {
            // TLS certificate for Eclipse Che hasn't been added into the cluster manually, so we need to take care about it automatically
            ctx.cheCertificateExists = false

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
        title: 'Updating Helm Chart dependencies',
        task: async (_ctx: any, task: any) => {
          if (VersionHelper.compareVersions('7.23.2', flags.version) === 1) {
            // Current version is below 7.23.2
            // Fix moved external depenency
            await this.pathcCheHelmChartPrometheusAndGrafanaDependencies(flags)
          }
          await this.updateCheHelmChartDependencies(flags)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Deploying Eclipse Che Helm Chart',
        task: async (ctx: any, task: any) => {
          await this.upgradeCheHelmChart(ctx, flags)
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
          task.title = `${task.title}...OK (Helm not found)`
        } else {
          await this.purgeHelmChart('che')
          task.title = `${task.title}...OK`
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

  private async pathcCheHelmChartPrometheusAndGrafanaDependencies(flags: any): Promise<void> {
    const helmChartDependenciesYamlPath = path.join(flags.templates, 'kubernetes', 'helm', 'che', 'requirements.yaml')
    const helmChartDependenciesYaml = this.kubeHelper.safeLoadFromYamlFile(helmChartDependenciesYamlPath)
    const deps: HelmChartDependency[] = helmChartDependenciesYaml && helmChartDependenciesYaml.dependencies || []
    let shouldReplaceYamlFile = false
    for (const dep of deps) {
      if (dep.name === 'prometheus' && dep.repository.startsWith('https://kubernetes-charts.storage.googleapis.com')) {
        dep.repository = 'https://prometheus-community.github.io/helm-charts'
        shouldReplaceYamlFile = true
      } else if (dep.name === 'grafana' && dep.repository.startsWith('https://kubernetes-charts.storage.googleapis.com')) {
        dep.repository = 'https://grafana.github.io/helm-charts'
        shouldReplaceYamlFile = true
      }
    }
    if (shouldReplaceYamlFile) {
      safeSaveYamlToFile(helmChartDependenciesYaml, helmChartDependenciesYamlPath)
    }
  }

  private async updateCheHelmChartDependencies(flags: any, execTimeout = 120000) {
    const destDir = path.join(flags.templates, 'kubernetes', 'helm', 'che')
    await execa(`helm dependencies update ${destDir}`, { timeout: execTimeout, shell: true })
  }

  private async upgradeCheHelmChart(ctx: any, flags: any, execTimeout = 120000) {
    const destDir = path.join(flags.templates, '/kubernetes/helm/che/')

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

    const selfSignedCertSecretExists = !! await this.kubeHelper.getSecret(CHE_ROOT_CA_SECRET_NAME, flags.chenamespace)
    setOptions.push(`--set global.tls.useSelfSignedCerts=${selfSignedCertSecretExists}`)

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

    if (flags.multiuser) {
      // Generate Keycloak admin password
      ctx.identityProviderUsername = 'admin'
      ctx.identityProviderPassword = generatePassword(12)
      setOptions.push(`--set che-keycloak.keycloakAdminUserPassword=${ctx.identityProviderPassword}`)
    }

    if (flags.cheimage) {
      setOptions.push(`--set cheImage=${flags.cheimage}`)
    }

    setOptions.push(`--set global.ingressDomain=${flags.domain}`)
    setOptions.push(`--set che.disableProbes=${flags.debug}`)

    const patchFlags = flags['helm-patch-yaml'] ? '-f ' + flags['helm-patch-yaml'] : ''

    let command = `helm upgrade --install che --force --namespace ${flags.chenamespace} ${setOptions.join(' ')} ${multiUserFlag} ${tlsFlag} ${patchFlags} ${destDir}`

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
