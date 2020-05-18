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
import { cli } from 'cli-ux'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { KubeHelper } from '../../api/kube'
import { cheDeployment, cheNamespace, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { CHE_CLUSTER_CR_NAME, DEFAULT_CHE_OPERATOR_IMAGE } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { OLMTasks } from '../../tasks/installers/olm'
import { ApiTasks } from '../../tasks/platforms/api'
import { CommonPlatformTasks } from '../../tasks/platforms/common-platform-tasks'
import { PlatformTasks } from '../../tasks/platforms/platform'
import { isKubernetesPlatformFamily } from '../../util'

export default class Update extends Command {
  static description = 'update Eclipse Che server'

  static flags = {
    installer: string({
      char: 'a',
      description: 'Installer type',
      options: ['helm', 'operator', 'minishift-addon', 'olm'],
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s (for kubernetes)\", \"openshift\", \"crc (for CodeReady Containers)\", \"microk8s\".',
      options: ['minikube', 'minishift', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
    }),
    chenamespace: cheNamespace,
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: Update.getTemplatesDir(),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
      default: DEFAULT_CHE_OPERATOR_IMAGE
    }),
    'skip-version-check': boolean({
      description: 'Skip user confirmation on version check',
      default: false
    }),
    'deployment-name': cheDeployment,
    'listr-renderer': listrRenderer,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    help: flags.help({ char: 'h' }),
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

  async checkIfInstallerSupportUpdating(flags: any) {
    // matrix checks
    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
    }

    if (flags.installer === 'operator' || flags.installer === 'olm') {
      // operator already supports updating
      return
    }

    if (flags.installer === 'minishift-addon' || flags.installer === 'helm') {
      this.error(`🛑 The specified installer ${flags.installer} does not support updating yet.`)
    }
    if (flags.installer === 'olm' && flags.platform === 'minishift') {
      this.error(`🛑 The specified installer ${flags.installer} does not support Minishift`)
    }

    this.error(`🛑 Unknown installer ${flags.installer} is specified.`)
  }

  async run() {
    const { flags } = this.parse(Update)
    const ctx: any = {}
    const listrOptions: Listr.ListrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false } as Listr.ListrOptions
    ctx.listrOptions = listrOptions
    // Holds messages which should be printed at the end of chectl log
    ctx.highlightedMessages = [] as string[]

    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks()
    const installerTasks = new InstallerTasks()
    const apiTasks = new ApiTasks()

    // Platform Checks
    const platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), listrOptions)
    platformCheckTasks.add(CommonPlatformTasks.oAuthProvidersExists(flags))

    await this.checkIfInstallerSupportUpdating(flags)

    // Checks if Eclipse Che is already deployed
    let preInstallTasks = new Listr(undefined, listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing Eclipse Che instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })

    const preUpdateTasks = new Listr(installerTasks.preUpdateTasks(flags, this), listrOptions)

    const updateTasks = new Listr(undefined, listrOptions)
    updateTasks.add({
      title: '↺  Updating...',
      task: () => new Listr(installerTasks.updateTasks(flags, this))
    })

    const postUpdateTasks = new Listr(undefined, listrOptions)
    postUpdateTasks.add(getPrintHighlightedMessagesTask())

    try {
      await preInstallTasks.run(ctx)

      if (!ctx.isCheDeployed) {
        this.error('Eclipse Che deployment is not found. Use `chectl server:start` to initiate new deployment.')
      } else {
        if (isKubernetesPlatformFamily(flags.platform!)) {
          await this.setDomainFlag(flags)
        }
        await platformCheckTasks.run(ctx)

        await preUpdateTasks.run(ctx)

        if (!flags['skip-version-check'] && flags.installer !== 'olm') {
          await cli.anykey(`      Found deployed Eclipse Che with operator [${ctx.deployedCheOperatorImage}]:${ctx.deployedCheOperatorTag}.
      You are going to update it to [${ctx.newCheOperatorImage}]:${ctx.newCheOperatorTag}.
      Note that Eclipse Che operator will update component images (server, plugin registry) only if their values
      are not overridden in eclipse-che Custom Resource. So, you may need to remove them manually.
      Press q to quit or any key to continue`)
        }

        await updateTasks.run(ctx)
        await postUpdateTasks.run(ctx)
      }
      this.log('Command server:update has completed successfully.')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }

  async setDomainFlag(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    const cheCluster = await kubeHelper.getCheCluster(CHE_CLUSTER_CR_NAME, flags.chenamespace)
    if (cheCluster && cheCluster.spec.k8s && cheCluster.spec.k8s.ingressDomain) {
      flags.domain = cheCluster.spec.k8s.ingressDomain
    }
  }

  async setDefaultInstaller(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    try {
      await kubeHelper.getOperatorSubscription(OLMTasks.SUBSCRIPTION_NAME, flags.chenamespace)
      flags.installer = 'olm'
    } catch {
      flags.installer = 'operator'
    }
    cli.info(`› Installer type is set to: '${flags.installer}'`)
  }
}
