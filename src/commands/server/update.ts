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
import * as Listr from 'listr'
import { merge } from 'lodash'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { assumeYes, cheDeployment, cheDeployVersion, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, DEPLOY_VERSION_KEY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_CHE_OPERATOR_IMAGE_NAME, MIN_CHE_OPERATOR_INSTALLER_VERSION, MIN_OLM_INSTALLER_VERSION, SUBSCRIPTION_NAME } from '../../constants'
import { getPrintHighlightedMessagesTask, prepareTemplates } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { getCommandErrorMessage, getCommandSuccessMessage, getCurrentChectlVersion, getLatestChectlVersion, notifyCommandCompletedSuccessfully } from '../../util'

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
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      env: 'CHE_TEMPLATES_FOLDER'
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
    [DEPLOY_VERSION_KEY]: cheDeployVersion,
  }

  async run() {
    const { flags } = this.parse(Update)
    const ctx = await ChectlContext.initAndGet(flags, this)

    await this.setDomainFlag(flags)
    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }

    if (flags.version) {
      if (flags.installer === 'olm') {
        this.error(`"${DEPLOY_VERSION_KEY}" flag is not supported for OLM installer.\nRunning update command will start updating process to the next version`)
      }

      if (flags.installer === 'operator' && VersionHelper.compareVersions(MIN_CHE_OPERATOR_INSTALLER_VERSION, flags.version) === 1) {
        throw new Error(this.getWrongVersionMessage(flags.version, MIN_CHE_OPERATOR_INSTALLER_VERSION))
      }
    }

    const installerTasks = new InstallerTasks()

    // pre update tasks
    const apiTasks = new ApiTasks()
    const preUpdateTasks = new Listr([], ctx.listrOptions)
    preUpdateTasks.add(apiTasks.testApiTasks(flags, this))
    preUpdateTasks.add(prepareTemplates(flags))
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
    if (cheCluster.spec.server.cheImage
      || cheCluster.spec.server.cheImageTag
      || cheCluster.spec.server.devfileRegistryImage
      || cheCluster.spec.database.postgresImage
      || cheCluster.spec.server.pluginRegistryImage
      || cheCluster.spec.auth.identityProviderImage) {
      let imagesListMsg = ''

      const resetImagesCrPatch: { [key: string]: any } = {}
      if (cheCluster.spec.server.pluginRegistryImage
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.server || !resetImagesCrPatch.spec.server.pluginRegistryImage)) {
        imagesListMsg += `\n - Plugin registry image: ${cheCluster.spec.server.pluginRegistryImage}`
        merge(resetImagesCrPatch, { spec: { server: { pluginRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.devfileRegistryImage
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.server || !resetImagesCrPatch.spec.server.devfileRegistryImage)) {
        imagesListMsg += `\n - Devfile registry image: ${cheCluster.spec.server.devfileRegistryImage}`
        merge(resetImagesCrPatch, { spec: { server: { devfileRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.postgresImage
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.database || !resetImagesCrPatch.spec.database.postgresImage)) {
        imagesListMsg += `\n - Postgres image: ${cheCluster.spec.database.postgresImage}`
        merge(resetImagesCrPatch, { spec: { database: { postgresImage: '' } } })
      }

      if (cheCluster.spec.server.identityProviderImage
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.auth || !resetImagesCrPatch.spec.auth.identityProviderImage)) {
        imagesListMsg += `\n - Identity provider image: ${cheCluster.spec.auth.identityProviderImage}`
        merge(resetImagesCrPatch, { spec: { auth: { identityProviderImage: '' } } })
      }

      if (cheCluster.spec.server.cheImage
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.server || !resetImagesCrPatch.spec.server.cheImage)) {
        imagesListMsg += `\n - Eclipse Che server image name: ${cheCluster.spec.server.cheImage}`
        merge(resetImagesCrPatch, { spec: { server: { cheImage: '' } } })
      }

      if (cheCluster.spec.server.cheImageTag
        && (!resetImagesCrPatch.spec || !resetImagesCrPatch.spec.server || !resetImagesCrPatch.spec.server.cheImageTag)) {
        imagesListMsg += `\n - Eclipse Che server image tag: ${cheCluster.spec.server.cheImageTag}`
        merge(resetImagesCrPatch, { spec: { server: { cheImageTag: '' } } })
      }

      if (imagesListMsg) {
        cli.warn(`Custom images found in '${cheCluster.metadata.name}' Custom Resource in the '${flags.chenamespace}' namespace: ${imagesListMsg}`)
        if (!flags.yes && await cli.confirm('Do you want to preserve custom images [y/n]?')) {
          cli.info('Keeping current images.\nNote, it might fail the update if some of he custom inages significantly change its internal functionality.')
        } else {
          cli.info('Resetting cutom images to default ones.')

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
        if (ctx.newCheOperatorImageTag === 'nightly' && ctx.downloadedNewTemplates) {
          // Current nightly version is not the latest one
          cli.info('Updating to newer nightly version')
          return true
        }

        cli.info('Eclipse Che is already up to date.')
        return false
      }

      if (VersionHelper.compareVersions(ctx.newCheOperatorImageTag, ctx.deployedCheOperatorImageTag) > 0) {
        // Upgrade

        if (!await this.currentChectlCanUpdateTo(ctx.newCheOperatorImageTag)) {
          const chectlChannel = ctx.newCheOperatorImageTag === 'nightly' ? 'next' : 'stable'
          const currentChectlVersion = getCurrentChectlVersion()
          const latestChectlVersion = await getLatestChectlVersion(chectlChannel)
          cli.warn(`It is not possible to update Eclipse Che to a newer version using the current '${currentChectlVersion}' version of chectl. Please, update 'chectl' to a newer version '${latestChectlVersion}' with the command 'chectl update ${chectlChannel}' and then try again.`)
          return false
        }

        // Print message
        if (ctx.newCheOperatorImageTag === 'nightly') {
          cli.info(`You are going to update Eclipse Che ${ctx.deployedCheOperatorImageTag} to possibly unstable nightly version`)
        } else {
          cli.info(`You are going to update Eclipse Che ${ctx.deployedCheOperatorImageTag} to ${ctx.newCheOperatorImageTag}`)
        }
      } else {
        // Downgrade

        if (VersionHelper.compareVersions(MIN_CHE_OPERATOR_INSTALLER_VERSION, flags.version) === 1) {
          cli.info(`Given Eclipse Che version ${flags.version} is too old to be downgraded to`)
          return false
        }

        cli.info(`You are going to downgrade Eclipse Che ${ctx.deployedCheOperatorImageTag} to ${ctx.newCheOperatorImageTag}`)
        cli.warn('DOWNGRADE IS NOT OFFICIALLY SUPPORTED, PROCEED ON YOUR OWN RISK')
      }
    } else {
      // At least one of the images is custom

      if (ctx.deployedCheOperatorImage === ctx.newCheOperatorImage) {
        cli.info('Eclipse Che is already up to date.')
        return false
      }

      // Print message
      if (ctx.deployedCheOperatorImageName !== DEFAULT_CHE_OPERATOR_IMAGE_NAME && ctx.newCheOperatorImageName !== DEFAULT_CHE_OPERATOR_IMAGE_NAME) {
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

    if (!flags.yes && !await cli.confirm('If you want to continue - press Y')) {
      cli.info('Update cancelled by user.')
      return false
    }

    return true
  }

  /**
   * Checks if current version of chectl is capable to deploy Eclipse Che of given version.
   * @param version Eclipse Che version to upate to, e.g. 7.20.1
   */
  // tslint:disable-next-line: no-unused
  async currentChectlCanUpdateTo(version: string): Promise<boolean> {
    // TODO As of now, chectl can deploy any version of Eclipse Che 7 (excluding some legacy ones prior to 7.10)
    // However, in the future, it may change. Deployment process might require some additional steps for newer versions.
    // This method is needed to compare required chectl version in templates (to be added) with its current version.
    return true
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
