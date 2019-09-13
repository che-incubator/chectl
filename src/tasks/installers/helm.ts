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
import { mkdirp, remove } from 'fs-extra'
import * as Listr from 'listr'
import { ncp } from 'ncp'
import * as path from 'path'

import { KubeHelper } from '../../api/kube'

export class HelmTasks {
  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if helm is installed',
        task: () => { if (!commandExists.sync('helm')) { command.error('E_REQUISITE_NOT_FOUND') } }
      },
      {
        title: 'Check for TLS secret prerequisites',
        // Check only if TLS is enabled
        enabled: () => {
          return flags.tls
        },
        task: async (_ctx: any, task: any) => {
          const kh = new KubeHelper(flags)
          const tlsSecret = await kh.getSecret('che-tls', `${flags.chenamespace}`)

          if (!tlsSecret) {
            throw new Error(`TLS option is enabled but che-tls secret does not exist in '${flags.chenamespace}' namespace. Example on how to create the secret with TLS: kubectl create secret tls che-tls --namespace='${flags.chenamespace}' --key=privkey.pem --cert=fullchain.pem`)
          }

          if (!tlsSecret.data['tls.crt'] || !tlsSecret.data['tls.key']) {
            throw new Error(`'che-tls' secret is found but 'tls.crt' or 'tls.key' entry is missing. Example on how to create the secret with self-signed CA certificate: kubectl create secret tls che-tls --namespace='${flags.chenamespace}' --key=privkey.pem --cert=fullchain.pem`)
          }

          task.title = `${task.title}...self-signed-cert secret found.`
        }
      },
      {
        title: 'Check for self-signed certificate prerequisites',
        // Check only if self-signed-cert is enabled
        enabled: () => {
          return flags['self-signed-cert']
        },
        task: async (_ctx: any, task: any) => {
          const kh = new KubeHelper(flags)
          const selfSignedCertSecret = await kh.getSecret('self-signed-cert', `${flags.chenamespace}`)

          if (!selfSignedCertSecret) {
            throw new Error(`Self-signed-cert option is enabled but 'self-signed-cert' secret does not exist in '${flags.chenamespace}' namespace. Example on how to create the secret with self-signed CA certificate: kubectl create secret generic self-signed-cert --namespace='${flags.chenamespace}' --from-file=ca.crt`)
          }

          if (!selfSignedCertSecret.data['ca.crt']) {
            throw new Error(`'self-signed-cert' secret is found but 'ca.crt' entry is missing. Example on how to create the secret with self-signed CA certificate: kubectl create secret tls che-tls --namespace='${flags.chenamespace}' --key=privkey.pem --cert=fullchain.pem`)
          }

          task.title = `${task.title}...che-tls secret found.`
        }
      },
      {
        title: 'Create Tiller Role Binding',
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
        title: 'Create Tiller Service Account',
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
        task: async () => this.createTillerRBAC(flags.templates)
      },
      {
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
        title: 'Preparing Che Helm Chart',
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
        title: 'Deploying Che Helm Chart',
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
      title: 'Purge che Helm chart',
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
    await ncp(srcDir, destDir, {}, (err: Error) => { if (err) { throw err } })
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

    setOptions.push(`--set global.ingressDomain=${flags.domain}`)
    setOptions.push(`--set cheImage=${flags.cheimage}`)
    setOptions.push(`--set global.cheWorkspacesNamespace=${flags.chenamespace}`)

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
