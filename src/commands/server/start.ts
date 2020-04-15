/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { boolean, string } from '@oclif/parser/lib/flags'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as os from 'os'
import * as path from 'path'

import { cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'
import { DEFAULT_CHE_IMAGE, DEFAULT_CHE_OPERATOR_IMAGE } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { PlatformTasks } from '../../tasks/platforms/platform'
import { isOpenshiftPlatformFamily } from '../../util'

export default class Start extends Command {
  static description = 'start Eclipse Che server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'deployment-name': cheDeployment,
    cheimage: string({
      char: 'i',
      description: 'Eclipse Che server container image',
      default: DEFAULT_CHE_IMAGE,
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: Start.getTemplatesDir(),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    'devfile-registry-url': string({
      description: 'The URL of the external Devfile registry.',
      env: 'CHE_WORKSPACE_DEVFILE__REGISTRY__URL'
    }),
    'plugin-registry-url': string({
      description: 'The URL of the external plugin registry.',
      env: 'CHE_WORKSPACE_PLUGIN__REGISTRY__URL'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Eclipse Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    }),
    k8spodwaittimeout: string({
      description: 'Waiting time for Pod Wait Timeout Kubernetes (in milliseconds)',
      default: '300000'
    }),
    k8spodreadytimeout: string({
      description: 'Waiting time for Pod Ready Kubernetes (in milliseconds)',
      default: '130000'
    }),
    multiuser: flags.boolean({
      char: 'm',
      description: 'Starts Eclipse Che in multi-user mode',
      default: false
    }),
    tls: flags.boolean({
      char: 's',
      description: `Enable TLS encryption.
                    Note, this option is turned on by default.
                    For Kubernetes infrastructure, it is required to provide own certificate: 'che-tls' secret with TLS certificate must be pre-created in the configured namespace.
                    The only exception is Helm installer. In that case the secret will be generated automatically.
                    For OpenShift, router will use default cluster certificates.
                    If the certificate is self-signed, '--self-signed-cert' option should be provided, otherwise Che won't be able to start.
                    Please see docs for more details: https://www.eclipse.org/che/docs/che-7/setup-che-in-tls-mode-with-self-signed-certificate/`
    }),
    'self-signed-cert': flags.boolean({
      description: `Authorize usage of self signed certificates for encryption.
                    This is the flag for Eclipse Che to propagate the certificate to components, so they will trust it.
                    Note that \`che-tls\` secret with CA certificate must be created in the configured namespace.`,
      default: false
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s (for kubernetes)\", \"openshift\", \"crc (for CodeReady Containers)\", \"microk8s\".',
      options: ['minikube', 'minishift', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
    }),
    installer: string({
      char: 'a',
      description: 'Installer type',
      options: ['helm', 'operator', 'olm', 'minishift-addon'],
      default: ''
    }),
    domain: string({
      char: 'b',
      description: `Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)
                    This flag makes sense only for Kubernetes family infrastructures and will be autodetected for Minikube and MicroK8s in most cases.
                    However, for Kubernetes cluster it is required to specify.
                    Please note, that just setting this flag will not likely work out of the box.
                    According changes should be done in Kubernetes cluster configuration as well.
                    In case of Openshift, domain adjustment should be done on the cluster configuration level.`,
      default: ''
    }),
    debug: boolean({
      description: 'Enables the debug mode for Eclipse Che server. To debug Eclipse Che server from localhost use \'server:debug\' command.',
      default: false
    }),
    'os-oauth': flags.boolean({
      description: 'Enable use of OpenShift credentials to log into Eclipse Che',
      default: false
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
      default: DEFAULT_CHE_OPERATOR_IMAGE
    }),
    'che-operator-cr-yaml': string({
      description: 'Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer is the operator.',
      default: ''
    }),
    'che-operator-cr-patch-yaml': string({
      description: 'Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used only when the installer is the operator.',
      default: ''
    }),
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      env: 'CHE_LOGS'
    }),
    'workspace-pvc-storage-class-name': string({
      description: 'persistent volume(s) storage class name to use to store Eclipse Che workspaces data',
      env: 'CHE_INFRA_KUBERNETES_PVC_STORAGE__CLASS__NAME',
      default: ''
    }),
    'postgres-pvc-storage-class-name': string({
      description: 'persistent volume storage class name to use to store Eclipse Che postgres database',
      default: ''
    }),
    'skip-version-check': flags.boolean({
      description: 'Skip minimal versions check.',
      default: false
    }),
    'skip-cluster-availability-check': flags.boolean({
      description: 'Skip cluster availability check. The check is a simple request to ensure the cluster is reachable.',
      default: false
    }),
    'auto-update': flags.boolean({
      description: `Auto update approval strategy for installation Eclipse Che.
                    With this strategy will be provided auto-update Eclipse Che without any human interaction.
                    By default strategy this flag is false. It requires approval from user.
                    To approve installation newer version Eclipse Che user should execute 'chectl server:update' command.
                    This parameter is used only when the installer is 'olm'.`,
      default: false
    }),
    'starting-csv': flags.string({
      description: `Starting cluster service version(CSV) for installation Eclipse Che.
                    Flags uses to set up start installation version Che.
                    For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
                    Then OLM will install Eclipse Che with version 7.10.0.
                    Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known version.
                    This parameter is used only when the installer is 'olm'.`
    })
  }

  static getTemplatesDir(): string {
    // return local templates folder if present
    const TEMPLATES = 'templates'
    const templatesDir = path.resolve(TEMPLATES)
    const exists = fs.pathExistsSync(templatesDir)
    if (exists) {
      return TEMPLATES
    }
    // else use the location from modules
    return path.join(__dirname, '../../../templates')
  }

  setPlaformDefaults(flags: any) {
    if (flags.platform === 'minishift') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'minishift-addon'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'minikube') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'helm'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'openshift') {
      if (flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'k8s') {
      if (flags.installer === '') {
        flags.installer = 'helm'
      }
    } else if (flags.platform === 'docker-desktop') {
      if (flags.installer === '') {
        flags.installer = 'helm'
      }
    } else if (flags.platform === 'crc') {
      if (flags.installer === '') {
        flags.installer = 'olm'
      }
    }

    // TODO when tls by default is implemented for all platforms, make `tls` flag turned on by default.
    if (flags.installer === 'helm' && (flags.platform === 'k8s' || flags.platform === 'minikube' || flags.platform === 'microk8s')) {
      flags.tls = true
    }
  }

  checkPlatformCompatibility(flags: any) {
    if (flags.installer === 'operator' && flags['che-operator-cr-yaml']) {
      const ignoredFlags = []
      flags['plugin-registry-url'] && ignoredFlags.push('--plugin-registry-urlomain')
      flags['devfile-registry-url'] && ignoredFlags.push('--devfile-registry-url')
      flags['postgres-pvc-storage-class-name'] && ignoredFlags.push('--postgres-pvc-storage-class-name')
      flags['workspace-pvc-storage-class-name'] && ignoredFlags.push('--workspace-pvc-storage-class-name')
      flags['self-signed-cert'] && ignoredFlags.push('--self-signed-cert')
      flags['os-oauth'] && ignoredFlags.push('--os-oauth')
      flags.tls && ignoredFlags.push('--tls')
      flags.cheimage && ignoredFlags.push('--cheimage')
      flags.debug && ignoredFlags.push('--debug')
      flags.domain && ignoredFlags.push('--domain')
      flags.multiuser && ignoredFlags.push('--multiuser')

      if (ignoredFlags.length) {
        this.warn(`--che-operator-cr-yaml is used. The following flag(s) will be ignored: ${ignoredFlags.join('\t')}`)
      }
    }

    if (flags.domain && !flags['che-operator-cr-yaml'] && isOpenshiftPlatformFamily(flags.platform)) {
      this.warn('"--domain" flag is ignored for Openshift family infrastructures. It should be done on the cluster level.')
    }

    if (flags.installer) {
      if (flags.installer === 'minishift-addon') {
        if (flags.platform !== 'minishift') {
          this.error(`🛑 Current platform is ${flags.platform}. Minishift-addon is only available for Minishift.`)
        }
      } else if (flags.installer === 'helm') {
        if (flags.platform !== 'k8s' && flags.platform !== 'minikube' && flags.platform !== 'microk8s' && flags.platform !== 'docker-desktop') {
          this.error(`🛑 Current platform is ${flags.platform}. Helm installer is only available on top of Kubernetes flavor platform (including Minikube, Docker Desktop).`)
        }
      }
      if (flags['os-oauth']) {
        if (flags.platform !== 'openshift' && flags.platform !== 'minishift' && flags.platform !== 'crc') {
          this.error(`You requested to enable OpenShift OAuth but the platform doesn\'t seem to be OpenShift. Platform is ${flags.platform}.`)
        }
        if (flags.installer !== 'operator') {
          this.error(`You requested to enable OpenShift OAuth but that's only possible when using the operator as installer. The current installer is ${flags.installer}. To use the operator add parameter "--installer operator".`)
        }
      }
      if (flags.installer === 'olm' && flags.platform === 'minishift') {
        this.error(`🛑 The specified installer ${flags.installer} does not support Minishift`)
      }
      if (flags.installer !== 'olm' && flags['auto-update']) {
        this.error('"auto-update" flag should be used only with "olm" installer.')
      }
      if (flags.installer !== 'olm' && flags['starting-csv']) {
        this.error('"starting-csv" flag should be used only with "olm" installer.')
      }
    }
  }

  async run() {
    const { flags } = this.parse(Start)
    const ctx: any = {}
    ctx.directory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
    const listrOptions: Listr.ListrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false, showSubtasks: true } as Listr.ListrOptions
    ctx.listrOptions = listrOptions
    // Holds messages which should be printed at the end of chectl log
    ctx.highlightedMessages = [] as string[]

    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks()
    const installerTasks = new InstallerTasks()
    const apiTasks = new ApiTasks()

    // Platform Checks
    let platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), listrOptions)

    // Checks if Eclipse Che is already deployed
    let preInstallTasks = new Listr(undefined, listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing Eclipse Che instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })

    this.setPlaformDefaults(flags)
    let installTasks = new Listr(installerTasks.installTasks(flags, this), listrOptions)

    const startDeployedCheTasks = new Listr([{
      title: '👀  Starting already deployed Eclipse Che',
      task: () => new Listr(cheTasks.scaleCheUpTasks(this))
    }], listrOptions)

    // Post Install Checks
    const postInstallTasks = new Listr([
      {
        title: '✅  Post installation checklist',
        task: () => new Listr(cheTasks.waitDeployedChe(flags, this))
      },
      {
        title: 'Show important messages',
        enabled: ctx => ctx.highlightedMessages.length > 0,
        task: (ctx: any) => {
          const printMessageTasks = new Listr([], ctx.listrOptions)
          for (const message of ctx.highlightedMessages) {
            printMessageTasks.add({
              title: message,
              task: () => { }
            })
          }
          return printMessageTasks
        }
      }
    ], listrOptions)

    const logsTasks = new Listr([{
      title: 'Start following logs',
      task: () => new Listr(cheTasks.serverLogsTasks(flags, true))
    }], listrOptions)

    const eventTasks = new Listr([{
      title: 'Start following events',
      task: () => new Listr(cheTasks.namespaceEventsTask(flags.chenamespace, this, true))
    }], listrOptions)

    try {
      await preInstallTasks.run(ctx)

      if (!ctx.isCheDeployed) {
        this.checkPlatformCompatibility(flags)
        await platformCheckTasks.run(ctx)
        this.log(`Eclipse Che logs will be available in '${ctx.directory}'`)
        await logsTasks.run(ctx)
        await eventTasks.run(ctx)
        await installTasks.run(ctx)
      } else if (!ctx.isCheReady
        || (ctx.isPostgresDeployed && !ctx.isPostgresReady)
        || (ctx.isKeycloakDeployed && !ctx.isKeycloakReady)
        || (ctx.isPluginRegistryDeployed && !ctx.isPluginRegistryReady)
        || (ctx.isDevfileRegistryDeployed && !ctx.isDevfileRegistryReady)) {
        if (flags.platform || flags.installer) {
          this.warn('Deployed Eclipse Che is found and the specified installation parameters will be ignored')
        }
        // perform Eclipse Che start task if there is any component that is not ready
        await startDeployedCheTasks.run(ctx)
      }

      await postInstallTasks.run(ctx)
      this.log('Command server:start has completed successfully.')
    } catch (err) {
      this.error(`${err}\nInstallation failed, check logs in '${ctx.directory}'`)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }
}
