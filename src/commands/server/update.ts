/**
 * Copyright (c) 2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as Listr from 'listr'
import { merge } from 'lodash'
import * as semver from 'semver'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, batch, cheDeployment, cheDeployVersion, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_TELEMETRY, DEPLOY_VERSION_KEY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_OPERATOR_IMAGE_NAME, MIN_CHE_OPERATOR_INSTALLER_VERSION, SUBSCRIPTION_NAME } from '../../constants'
import { checkChectlAndCheVersionCompatibility, downloadTemplates, getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { askForChectlUpdateIfNeeded, findWorkingNamespace, getCommandErrorMessage, getCommandSuccessMessage, getEmbeddedTemplatesDirectory, getProjectName, getProjectVersion, notifyCommandCompletedSuccessfully } from '../../util'

export default class Update extends Command {
  static description = 'Update Eclipse Che server.'

  static examples = [
    '# Update Eclipse Che:\n' +
    'chectl server:update',
    '\n# Update Eclipse Che in \'eclipse-che\' namespace:\n' +
    'chectl server:update -n eclipse-che',
    '\n# Update Eclipse Che and update its configuration in the custom resource:\n' +
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
    batch,
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      env: 'CHE_TEMPLATES_FOLDER',
      exclusive: [DEPLOY_VERSION_KEY],
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
      hidden: true,
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
    telemetry: CHE_TELEMETRY,
    [DEPLOY_VERSION_KEY]: cheDeployVersion,
  }

  async run() {
    const { flags } = this.parse(Update)
    flags.chenamespace = await findWorkingNamespace(flags)
    const ctx = await ChectlContext.initAndGet(flags, this)

    if (!flags.batch && ctx.isChectl) {
      await askForChectlUpdateIfNeeded()
    }

    await this.setDomainFlag(flags)
    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Update.id, flags })

    if (!flags.templates && !flags.version) {
      // Use build-in templates if no custom templates nor version to deploy specified.
      // All flavors should use embedded templates if not custom templates is given.
      flags.templates = getEmbeddedTemplatesDirectory()
    }

    if (flags.version) {
      if (!ctx.isChectl) {
        // Flavors of chectl should not use upstream repositories, so version flag is not appliable
        this.error(`${getProjectName()} does not support '--version' flag.`)
      }
      if (flags.installer === 'olm') {
        this.error(`'--${DEPLOY_VERSION_KEY}' flag is not supported for OLM installer. 'server:update' command automatically updates to the next available version.`)
      }

      let isVersionAllowed = false
      try {
        isVersionAllowed = semver.gte(flags.version, MIN_CHE_OPERATOR_INSTALLER_VERSION)
      } catch (error) {
        // not to fail unexpectedly
        cli.debug(`Failed to compare versions '${flags.version}' and '${MIN_CHE_OPERATOR_INSTALLER_VERSION}': ${error}`)
      }

      if (flags.installer === 'operator' && !isVersionAllowed) {
        throw new Error(this.getWrongVersionMessage(flags.version, MIN_CHE_OPERATOR_INSTALLER_VERSION))
      }
    }

    const installerTasks = new InstallerTasks()

    // pre update tasks
    const apiTasks = new ApiTasks()
    const preUpdateTasks = new Listr([], ctx.listrOptions)
    preUpdateTasks.add(apiTasks.testApiTasks(flags, this))
    preUpdateTasks.add(checkChectlAndCheVersionCompatibility(flags))
    preUpdateTasks.add(downloadTemplates(flags))
    preUpdateTasks.add(installerTasks.preUpdateTasks(flags, this))

    // update tasks
    const updateTasks = new Listr([], ctx.listrOptions)
    updateTasks.add({
      title: '↺  Updating...',
      task: () => new Listr(installerTasks.updateTasks(flags, this)),
    })

    // post update tasks
    const postUpdateTasks = new Listr([], ctx.listrOptions)
    postUpdateTasks.add(getPrintHighlightedMessagesTask())

    try {
      await preUpdateTasks.run(ctx)

      if (flags.installer === 'operator') {
        if (!await this.checkAbilityToUpdateCheOperatorAndAskUser(flags)) {
          // Exit
          return
        }
      }
      await this.checkComponentImages(flags)

      await updateTasks.run(ctx)
      await postUpdateTasks.run(ctx)

      this.log(getCommandSuccessMessage())
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }

    notifyCommandCompletedSuccessfully()
  }

  /**
   * Tests if existing Che installation uses custom docker images.
   * If so, asks user whether keep custom images or revert to default images and update them.
   */
  private async checkComponentImages(flags: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)
    const cheCluster = await kubeHelper.getCheCluster(flags.chenamespace)
    if (cheCluster.spec.server.cheImage ||
      cheCluster.spec.server.cheImageTag ||
      cheCluster.spec.server.devfileRegistryImage ||
      cheCluster.spec.database.postgresImage ||
      cheCluster.spec.server.pluginRegistryImage ||
      cheCluster.spec.auth.identityProviderImage) {
      let imagesListMsg = ''

      const resetImagesCrPatch: { [key: string]: any } = {}
      if (cheCluster.spec.server.pluginRegistryImage) {
        imagesListMsg += `\n - Plugin registry image: ${cheCluster.spec.server.pluginRegistryImage}`
        merge(resetImagesCrPatch, { spec: { server: { pluginRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.devfileRegistryImage) {
        imagesListMsg += `\n - Devfile registry image: ${cheCluster.spec.server.devfileRegistryImage}`
        merge(resetImagesCrPatch, { spec: { server: { devfileRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.postgresImage) {
        imagesListMsg += `\n - Postgres image: ${cheCluster.spec.database.postgresImage}`
        merge(resetImagesCrPatch, { spec: { database: { postgresImage: '' } } })
      }

      if (cheCluster.spec.server.identityProviderImage) {
        imagesListMsg += `\n - Identity provider image: ${cheCluster.spec.auth.identityProviderImage}`
        merge(resetImagesCrPatch, { spec: { auth: { identityProviderImage: '' } } })
      }

      if (cheCluster.spec.server.cheImage) {
        imagesListMsg += `\n - Eclipse Che server image name: ${cheCluster.spec.server.cheImage}`
        merge(resetImagesCrPatch, { spec: { server: { cheImage: '' } } })
      }

      if (cheCluster.spec.server.cheImageTag) {
        imagesListMsg += `\n - Eclipse Che server image tag: ${cheCluster.spec.server.cheImageTag}`
        merge(resetImagesCrPatch, { spec: { server: { cheImageTag: '' } } })
      }

      if (imagesListMsg) {
        cli.warn(`Custom images found in '${cheCluster.metadata.name}' Custom Resource in the '${flags.chenamespace}' namespace: ${imagesListMsg}`)
        if (flags.batch || flags.yes || await cli.confirm('Do you want to preserve custom images [y/n]?')) {
          cli.info('Keeping current images.\nNote, Update might fail if functionality of the custom images different from the default ones.')
        } else {
          cli.info('Resetting custom images to default ones.')

          const ctx = ChectlContext.get()
          const crPatch = ctx[ChectlContext.CR_PATCH] || {}
          merge(crPatch, resetImagesCrPatch)
          ctx[ChectlContext.CR_PATCH] = crPatch
        }
      }
    }
  }

  /**
   * Check whether chectl should proceed with update.
   * Asks user for confirmation (unless assume yes is provided).
   * Is applicable to operator installer only.
   * Returns true if chectl can/should proceed with update, false otherwise.
   */
  private async checkAbilityToUpdateCheOperatorAndAskUser(flags: any): Promise<boolean> {
    const ctx = ChectlContext.get()
    cli.info(`Existing Eclipse Che operator: ${ctx.deployedCheOperatorImage}`)
    cli.info(`New Eclipse Che operator     : ${ctx.newCheOperatorImage}`)

    if (ctx.deployedCheOperatorImageName === DEFAULT_CHE_OPERATOR_IMAGE_NAME && ctx.newCheOperatorImageName === DEFAULT_CHE_OPERATOR_IMAGE_NAME) {
      // Official images

      if (ctx.deployedCheOperatorImage === ctx.newCheOperatorImage) {
        if (ctx.newCheOperatorImageTag === 'nightly') {
          cli.info('Updating current Eclipse Che nightly version to a new one.')
          return true
        }

        if (flags[CHE_OPERATOR_CR_PATCH_YAML_KEY]) {
          // Despite the operator image is the same, CR patch might contain some changes.
          cli.info('Patching existing Eclipse Che installation.')
          return true
        }
        cli.info('Eclipse Che is already up to date.')
        return false
      }

      if (this.isUpgrade(ctx.deployedCheOperatorImageTag, ctx.newCheOperatorImageTag)) {
        // Upgrade

        const currentChectlVersion = getProjectVersion()
        if (!ctx.isNightly && (ctx.newCheOperatorImageTag === 'nightly' || semver.lt(currentChectlVersion, ctx.newCheOperatorImageTag))) {
          // Upgrade is not allowed
          if (ctx.newCheOperatorImageTag === 'nightly') {
            cli.warn(`Stable ${getProjectName()} cannot update stable Eclipse Che to nightly version`)
          } else {
            cli.warn(`It is not possible to update Eclipse Che to a newer version using the current '${currentChectlVersion}' version of chectl. Please, update '${getProjectName()}' to a newer version using command '${getProjectName()} update' and then try again.`)
          }
          return false
        }

        // Upgrade allowed
        if (ctx.newCheOperatorImageTag === 'nightly') {
          cli.info(`You are going to update Eclipse Che ${ctx.deployedCheOperatorImageTag} to nightly version.`)
        } else {
          cli.info(`You are going to update Eclipse Che ${ctx.deployedCheOperatorImageTag} to ${ctx.newCheOperatorImageTag}`)
        }
      } else {
        // Downgrade

        let isVersionAllowed = false
        try {
          isVersionAllowed = semver.gte(flags.version, MIN_CHE_OPERATOR_INSTALLER_VERSION)
        } catch (error) {
          // not to fail unexpectedly
          cli.debug(`Failed to compare versions '${flags.version}' and '${MIN_CHE_OPERATOR_INSTALLER_VERSION}': ${error}`)
        }

        if (!isVersionAllowed) {
          cli.info(`Given Eclipse Che version ${flags.version} is too old to be downgraded to`)
          return false
        }

        cli.info(`You are going to downgrade Eclipse Che ${ctx.deployedCheOperatorImageTag} to ${ctx.newCheOperatorImageTag}`)
        cli.warn('DOWNGRADE IS NOT OFFICIALLY SUPPORTED, PROCEED ON YOUR OWN RISK')
      }
    } else {
      // At least one of the images is custom

      // Print message
      if (ctx.deployedCheOperatorImage === ctx.newCheOperatorImage) {
        // Despite the image is the same it could be updated image, replace anyway.
        cli.info(`You are going to replace Eclipse Che operator image ${ctx.newCheOperatorImage}.`)
      } else if (ctx.deployedCheOperatorImageName !== DEFAULT_CHE_OPERATOR_IMAGE_NAME && ctx.newCheOperatorImageName !== DEFAULT_CHE_OPERATOR_IMAGE_NAME) {
        // Both images are custom
        cli.info(`You are going to update ${ctx.deployedCheOperatorImage} to ${ctx.newCheOperatorImage}`)
      } else {
        // One of the images is offical
        if (ctx.deployedCheOperatorImageName === DEFAULT_CHE_OPERATOR_IMAGE_NAME) {
          // Update from offical to custom image
          cli.info(`You are going to update official ${ctx.deployedCheOperatorImage} image with user provided one: ${ctx.newCheOperatorImage}`)
        } else { // ctx.newCheOperatorImageName === DEFAULT_CHE_OPERATOR_IMAGE_NAME
          // Update from custom to official image
          cli.info(`You are going to update user provided image ${ctx.deployedCheOperatorImage} with official one: ${ctx.newCheOperatorImage}`)
        }
      }
    }

    if (!flags.batch && !flags.yes && !await cli.confirm('If you want to continue - press Y')) {
      cli.info('Update cancelled by user.')
      return false
    }

    return true
  }

  /**
   * Checks if official operator image is replaced with a newer one.
   * Tags are allowed in format x.y.z or nightly.
   * nightly is considered the most recent.
   * For example:
   *  (7.22.1, 7.23.0) -> true,
   *  (7.22.1, 7.20.2) -> false,
   *  (7.22.1, nightly) -> true,
   *  (nightly, 7.20.2) -> false
   * @param oldTag old official operator image tag, e.g. 7.20.1
   * @param newTag new official operator image tag e.g. 7.22.0
   * @returns true if upgrade, false if downgrade
   * @throws error if tags are equal
   */
  private isUpgrade(oldTag: string, newTag: string): boolean {
    if (oldTag === newTag) {
      throw new Error(`Tags are the same: ${newTag}`)
    }

    let isUpdate = false
    try {
      isUpdate = semver.gt(newTag, oldTag)
    } catch (error) {
      // not to fail unexpectedly
      cli.debug(`Failed to compare versions '${newTag}' and '${oldTag}': ${error}`)
    }

    // if newTag is nightly it is upgrade
    // if oldTag is nightly it is downgrade
    // otherwise just compare new and old tags
    // Note, that semver lib doesn't handle text tags and throws an error in case nightly is provided for comparation.
    return newTag === 'nightly' || (oldTag !== 'nightly' && isUpdate)
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

  private getWrongVersionMessage(current: string, minimal: string): string {
    return `This chectl version can deploy ${minimal} version and higher, but ${current} is provided. If you really need to deploy that old version, please download corresponding legacy chectl version.`
  }
}
