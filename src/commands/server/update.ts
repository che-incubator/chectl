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
import { cli } from 'cli-ux'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as path from 'path'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, cheDeployment, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_OPERATOR_IMAGE, SUBSCRIPTION_NAME } from '../../constants'
import { getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { CommonPlatformTasks } from '../../tasks/platforms/common-platform-tasks'
import { getCommandErrorMessage, getCommandSuccessMessage, getImageTag, notifyCommandCompletedSuccessfully } from '../../util'

export default class Update extends Command {
  static description = 'Update Eclipse Che server.'

  static flags: flags.Input<any> = {
    installer: string({
      char: 'a',
      description: 'Installer type. If not set, default is autodetected depending on previous installation.',
      options: ['operator', 'olm'],
      hidden: true,
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s (for kubernetes)\", \"openshift\", \"crc (for CodeReady Containers)\", \"microk8s\".',
      options: ['minikube', 'minishift', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
      hidden: true,
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
    'skip-version-check': flags.boolean({
      description: 'Skip minimal versions check.',
      default: false,
      hidden: true,
    }),
    'deployment-name': cheDeployment,
    'listr-renderer': listrRenderer,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    yes: assumeYes,
    help: flags.help({ char: 'h' }),
    [CHE_OPERATOR_CR_PATCH_YAML_KEY]: cheOperatorCRPatchYaml,
    telemetry: CHE_TELEMETRY
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

  async run() {
    const { flags } = this.parse(Update)
    const ctx = await ChectlContext.initAndGet(flags, this)

    await this.setDomainFlag(flags)
    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }
    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Update.id, flags })

    const kubeHelper = new KubeHelper(flags)
    const installerTasks = new InstallerTasks()

    // pre update tasks
    const apiTasks = new ApiTasks()
    const preUpdateTasks = new Listr([], ctx.listrOptions)
    preUpdateTasks.add(apiTasks.testApiTasks(flags, this))
    preUpdateTasks.add(CommonPlatformTasks.oAuthProvidersExists(flags))
    preUpdateTasks.add(installerTasks.preUpdateTasks(flags, this))

    // update tasks
    const updateTasks = new Listr([], ctx.listrOptions)
    updateTasks.add({
      title: '↺  Updating...',
      task: () => new Listr(installerTasks.updateTasks(flags, this))
    })

    // post update tasks
    const postUpdateTasks = new Listr([], ctx.listrOptions)
    postUpdateTasks.add(getPrintHighlightedMessagesTask())

    try {
      await preUpdateTasks.run(ctx)

      if (!flags.yes) {
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

      this.log(getCommandSuccessMessage())
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }

    notifyCommandCompletedSuccessfully()
    this.exit(0)
  }

  /**
   * Copies spec.k8s.ingressDomain. It is needed later for updates.
   */
  private async setDomainFlag(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    const cheCluster = await kubeHelper.getCheCluster(flags.chenamespace)
    if (cheCluster && cheCluster.spec.k8s && cheCluster.spec.k8s.ingressDomain) {
      flags.domain = cheCluster.spec.k8s.ingressDomain
    }
  }

  /**
   * Sets installer type depending on the previous installation.
   */
  private async setDefaultInstaller(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    try {
      await kubeHelper.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
      flags.installer = 'olm'
    } catch {
      flags.installer = 'operator'
    }
  }
}
