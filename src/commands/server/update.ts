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
import { assumeYes, cheDeployment, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_CHE_OPERATOR_IMAGE, SUBSCRIPTION_NAME } from '../../constants'
import { getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { CommonPlatformTasks } from '../../tasks/platforms/common-platform-tasks'
import { getCommandErrorMessage, getCommandSuccessMessage, getCurrentChectlVersion, getImageTag, getLatestChectlVersion, isStableVersion, notifyCommandCompletedSuccessfully } from '../../util'

export default class Update extends Command {
  static description = 'Update Eclipse Che server.'

  static examples = [
    '# Update Eclipse Che:\n' +
    'chectl server:update',
    '\n\n# Update Eclipse Che in \'eclipse-che\' namespace:' +
    'chectl server:update -n eclipse-che',
    '\n\n# Update Eclipse Che and update its configuration in the custom resource:' +
    `chectl server:update --${CHE_OPERATOR_CR_PATCH_YAML_KEY} patch.yaml`,
  ]

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
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }

    if (!flags.yes) {
      const existedOperatorImage = `${ctx.deployedCheOperatorImage}:${ctx.deployedCheOperatorTag}`
      const newOperatorImage = `${ctx.newCheOperatorImage}:${ctx.newCheOperatorTag}`
      cli.info(`Existed Eclipse Che operator: ${existedOperatorImage}.`)
      cli.info(`New Eclipse Che operator    : ${newOperatorImage}.`)

      if (flags.installer === 'operator') {
        const operatorImageTag = getImageTag(DEFAULT_CHE_OPERATOR_IMAGE)
        const chectlChannel = operatorImageTag === 'nightly' ? 'next' : 'stable'
        const currentChectlVersion = getCurrentChectlVersion()
        const latestChectlVersion = await getLatestChectlVersion(chectlChannel)

        // Warn user to update chectl to update Eclipse Che to the latest version
        if (newOperatorImage === existedOperatorImage) {
          // suggest update chectl first
          if (currentChectlVersion !== latestChectlVersion) {
            cli.warn(`'chectl' tool is not up to date.
Update 'chectl' first: 'chectl update ${chectlChannel}' and then try again.`)
          } else {
            // same image, no patch
            if (!flags[CHE_OPERATOR_CR_PATCH_YAML_KEY]) {
              cli.info('Eclipse Che is already up to date.')
              this.exit(0)
            }
          }
          // custom operator image is used
        } else if (newOperatorImage !== DEFAULT_CHE_OPERATOR_IMAGE) {
          cli.warn(`Eclipse Che operator deployment will be updated with the provided image,
but other Eclipse Che components will be updated to the ${operatorImageTag} version.
Consider removing '--che-operator-image' to update Eclipse Che operator to the same version.`)
        }
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

    try {
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
