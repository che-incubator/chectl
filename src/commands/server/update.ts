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
import { cheDeployment, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_CHE_OPERATOR_IMAGE, SUBSCRIPTION_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { readCRPatchFile } from '../../util'
import { getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { CommonPlatformTasks } from '../../tasks/platforms/common-platform-tasks'
import { PlatformTasks } from '../../tasks/platforms/platform'
import { getCommandSuccessMessage, getImageTag, initializeContext, isKubernetesPlatformFamily } from '../../util'

export default class Update extends Command {
  static description = 'Update Eclipse Che server.'

  static flags: flags.Input<any> = {
    installer: string({
      char: 'a',
      description: 'Installer type. If not set, default is autodetected depending on previous installation.',
      options: ['operator', 'olm'],
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
    [CHE_OPERATOR_CR_PATCH_YAML_KEY]: cheOperatorCRPatchYaml,
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
    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }

    if (flags.installer === 'operator' || flags.installer === 'olm') {
      // operator already supports updating
      return
    }

    if (flags.installer === 'olm' && flags.platform === 'minishift') {
      this.error(`🛑 The specified installer ${flags.installer} does not support Minishift`)
    }
  }

  async run() {
    const { flags } = this.parse(Update)
    const ctx = initializeContext()
    const listrOptions: Listr.ListrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false } as Listr.ListrOptions
    ctx.listrOptions = listrOptions
    ctx.CRPatch = readCRPatchFile(flags, this)

    const cheTasks = new CheTasks(flags)
    const kubeHelper = new KubeHelper(flags)
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
        this.error('Eclipse Che deployment is not found. Use `chectl server:deploy` to initiate a new deployment.')
      } else {
        if (isKubernetesPlatformFamily(flags.platform!)) {
          await this.setDomainFlag(flags)
        }
        await platformCheckTasks.run(ctx)
        await preUpdateTasks.run(ctx)

        if (!flags['skip-version-check']) {
          cli.info(`Existed Eclipse Che operator: ${ctx.deployedCheOperatorImage}:${ctx.deployedCheOperatorTag}.`)
          cli.info(`New Eclipse Che operator    : ${ctx.newCheOperatorImage}:${ctx.newCheOperatorTag}.`)

          if (flags['che-operator-image'] !== DEFAULT_CHE_OPERATOR_IMAGE) {
            cli.warn(`This command updates Eclipse Che to ${getImageTag(DEFAULT_CHE_OPERATOR_IMAGE)} version, but custom operator image is specified.`)
            cli.warn('Make sure that the new version of the Eclipse Che is corresponding to the version of the tool you use.')
            cli.warn('Consider using \'chectl update [stable|next]\' to update to the latest version of chectl.')
          }

          const cheCluster = await kubeHelper.getCheCluster(flags.chenamespace)
          if (cheCluster.spec.server.cheImage
            || cheCluster.spec.server.cheImageTag
            || cheCluster.spec.server.devfileRegistryImage
            || cheCluster.spec.database.postgresImage
            || cheCluster.spec.server.pluginRegistryImage
            || cheCluster.spec.auth.identityProviderImage) {
            cli.warn(`In order to update Eclipse Che the images defined in the '${cheCluster.metadata.name}'
            Custom Resource of the namespace '${flags.chenamespace}' will be cleaned up:`)
            cheCluster.spec.server.cheImageTag && cli.warn(`Eclipse Che server image tag [${cheCluster.spec.server.cheImageTag}]`)
            cheCluster.spec.server.cheImage && cli.warn(`Eclipse Che server [${cheCluster.spec.server.cheImage}]`)
            cheCluster.spec.database.postgresImage && cli.warn(`Database [${cheCluster.spec.database.postgresImage}]`)
            cheCluster.spec.server.devfileRegistryImage && cli.warn(`Devfile registry [${cheCluster.spec.server.devfileRegistryImage}]`)
            cheCluster.spec.server.pluginRegistryImage && cli.warn(`Plugin registry [${cheCluster.spec.server.pluginRegistryImage}]`)
            cheCluster.spec.auth.identityProviderImage && cli.warn(`Identity provider [${cheCluster.spec.auth.identityProviderImage}]`)
          }

          const confirmed = await cli.confirm('If you want to continue - press Y')
          if (!confirmed) {
            this.exit(0)
          }
        }

        await updateTasks.run(ctx)
        await postUpdateTasks.run(ctx)
      }
      this.log(getCommandSuccessMessage(this, ctx))
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: getCommandSuccessMessage(this, ctx)
    })

    this.exit(0)
  }

  async setDomainFlag(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    const cheCluster = await kubeHelper.getCheCluster(flags.chenamespace)
    if (cheCluster && cheCluster.spec.k8s && cheCluster.spec.k8s.ingressDomain) {
      flags.domain = cheCluster.spec.k8s.ingressDomain
    }
  }

  async setDefaultInstaller(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    try {
      await kubeHelper.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
      flags.installer = 'olm'
    } catch {
      flags.installer = 'operator'
    }
  }
}
