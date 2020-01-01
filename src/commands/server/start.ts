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
import { string } from '@oclif/parser/lib/flags'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'
import { DEFAULT_CHE_IMAGE, DEFAULT_CHE_OPERATOR_IMAGE } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { InstallerTasks } from '../../tasks/installers/installer'
import { K8sTasks } from '../../tasks/platforms/k8s'
import { PlatformTasks } from '../../tasks/platforms/platform'

export default class Start extends Command {
  static description = 'start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'deployment-name': cheDeployment,
    cheimage: string({
      char: 'i',
      description: 'Che server container image',
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
      description: 'Che server bootstrap timeout (in milliseconds)',
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
      description: 'Starts che in multi-user mode',
      default: false
    }),
    tls: flags.boolean({
      char: 's',
      description: `Enable TLS encryption.
                    Note that for kubernetes 'che-tls' with TLS certificate must be created in the configured namespace.
                    For OpenShift, router will use default cluster certificates.`,
      default: false
    }),
    'self-signed-cert': flags.boolean({
      description: 'Authorize usage of self signed certificates for encryption. Note that `self-signed-cert` secret with CA certificate must be created in the configured namespace.',
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
      options: ['helm', 'operator', 'minishift-addon'],
      default: ''
    }),
    domain: string({
      char: 'b',
      description: 'Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)',
      default: ''
    }),
    'os-oauth': flags.boolean({
      description: 'Enable use of OpenShift credentials to log into Che',
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
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      default: './logs'
    }),
    // 'host-persistent-volume-name': string({
    //   description: 'Path to the already created persisted volume in the node host. Parameter is used only when installer is operator.',
    //   default: ''
    // }),
    'host-persisted-volume-storage-class-name': string({
      description: 'Path to a yaml file that defines node host persisted volume storage class. Parameter is used only when installer is operator.',
      default: ''
    }),
    'pvc-host-volume-path': string({
      description: 'Path to a yaml file that defines node host persisted volume storage class. Parameter is used only when installer is operator.',
      default: ''
    }),
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

  static setPlaformDefaults(flags: any) {
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
        flags.installer = 'operator'
      }
    }
  }

  checkPlatformCompatibility(flags: any) {
    // matrix checks
    if (flags.installer) {
      if (flags.installer === 'minishift-addon') {
        if (flags.platform !== 'minishift') {
          this.error(`🛑 Current platform is ${flags.platform}. Minishift addon is only available on top of Minishift platform.`)
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
    }
  }

  async run() {
    const { flags } = this.parse(Start)
    const listrOptions: Listr.ListrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false, showSubtasks: true } as Listr.ListrOptions

    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks()
    const installerTasks = new InstallerTasks()
    const k8sTasks = new K8sTasks()

    // Platform Checks
    let platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), listrOptions)

    // Checks if Che is already deployed
    let preInstallTasks = new Listr(undefined, listrOptions)
    preInstallTasks.add(k8sTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing Che instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })

    Start.setPlaformDefaults(flags)
    let installTasks = new Listr(installerTasks.installTasks(flags, this), listrOptions)

    const startDeployedCheTasks = new Listr([{
      title: '👀  Starting already deployed Che',
      task: () => new Listr(cheTasks.scaleCheUpTasks(this))
    }], listrOptions)

    // Post Install Checks
    const postInstallTasks = new Listr([{
      title: '✅  Post installation checklist',
      task: () => new Listr(cheTasks.waitDeployedChe(flags, this))
    }], listrOptions)

    const logsTasks = new Listr([{
      title: 'Start following logs',
      task: () => new Listr(cheTasks.serverLogsTasks(flags, true))
    }], listrOptions)

    try {
      const ctx: any = {}
      await preInstallTasks.run(ctx)

      if (!ctx.isCheDeployed) {
        this.checkPlatformCompatibility(flags)
        await platformCheckTasks.run(ctx)
        await logsTasks.run(ctx)
        await installTasks.run(ctx)
      } else if (!ctx.isCheReady
        || (ctx.isPostgresDeployed && !ctx.isPostgresReady)
        || (ctx.isKeycloakDeployed && !ctx.isKeycloakReady)
        || (ctx.isPluginRegistryDeployed && !ctx.isPluginRegistryReady)
        || (ctx.isDevfileRegistryDeployed && !ctx.isDevfileRegistryReady)) {
        if (flags.platform || flags.installer) {
          this.warn('Deployed Che is found and the specified installation parameters will be ignored')
        }
        // perform Che start task if there is any component that is not ready
        await startDeployedCheTasks.run(ctx)
      }

      await postInstallTasks.run(ctx)
      this.log('Command server:start has completed successfully.')
    } catch (err) {
      this.error(err)
    } finally {
      this.log(`Eclipse Che logs will be available in '${path.resolve(flags.directory)}'`)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }
}
