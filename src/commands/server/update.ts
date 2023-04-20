/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
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
import { cli } from 'cli-ux'
import * as semver from 'semver'

import {
  CheCtlContext,
  CliContext,
  EclipseCheContext,
  InfrastructureContext,
  OperatorImageUpgradeContext,
} from '../../context'

import { EclipseCheInstallerFactory } from '../../tasks/installers/eclipse-che/eclipse-che-installer-factory'
import {
  ASSUME_YES,
  ASSUME_YES_FLAG,
  AUTO_UPDATE_FLAG,
  BATCH,
  BATCH_FLAG,
  CATALOG_SOURCE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  CHE_NAMESPACE_FLAG,
  CHE_OPERATOR_CR_PATCH_YAML,
  CHE_OPERATOR_CR_PATCH_YAML_FLAG,
  CHE_OPERATOR_IMAGE,
  CHE_OPERATOR_IMAGE_FLAG,
  LISTR_RENDERER,
  LISTR_RENDERER_FLAG,
  OLM_CHANNEL,
  OLM_CHANNEL_FLAG,
  PACKAGE_MANIFEST,
  PACKAGE_MANIFEST_FLAG,
  SKIP_DEV_WORKSPACE,
  SKIP_DEV_WORKSPACE_FLAG,
  SKIP_KUBE_HEALTHZ_CHECK,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG,
  SKIP_VERSION_CHECK,
  SKIP_VERSION_CHECK_FLAG,
  STARTING_CSV_FLAG,
  TELEMETRY,
  TELEMETRY_FLAG,
  TEMPLATES,
  TEMPLATES_FLAG,
  CATALOG_SOURCE_NAME,
  AUTO_UPDATE,
  STARTING_CSV,
  CATALOG_SOURCE_NAMESPACE,
  CATALOG_SOURCE_NAME_FLAG,
  CATALOG_SOURCE_YAML_FLAG,
  CATALOG_SOURCE_YAML,
} from '../../flags'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {DEFAULT_ANALYTIC_HOOK_NAME} from '../../constants'
import {
  askForChectlUpdateIfNeeded,
  getCommandSuccessMessage,
  notifyCommandCompletedSuccessfully,
  wrapCommandError,
} from '../../utils/command-utils'
import {CommonTasks} from '../../tasks/common-tasks'
import {getProjectName, getProjectVersion, isCheFlavor, newListr} from '../../utils/utls'
import {KubeClient} from '../../api/kube-client'

export default class Update extends Command {
  static description = `Update ${EclipseChe.PRODUCT_NAME} server.`

  static examples = [
    `# Update ${EclipseChe.PRODUCT_NAME}:\n` +
    'chectl server:update',
    `\n# Update ${EclipseChe.PRODUCT_NAME} in \'eclipse-che\' namespace:\n` +
    'chectl server:update -n eclipse-che',
    `\n# Update ${EclipseChe.PRODUCT_NAME} and update its configuration in the custom resource:\n` +
    `chectl server:update --${CHE_OPERATOR_CR_PATCH_YAML_FLAG} patch.yaml`,
    `\n# Update ${EclipseChe.PRODUCT_NAME} and switch to a different channel:\n` +
    'chectl server:update --olm-channel next',
  ]

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [BATCH_FLAG]: BATCH,
    [ASSUME_YES_FLAG]: ASSUME_YES,
    [TEMPLATES_FLAG]: TEMPLATES,
    [CHE_OPERATOR_IMAGE_FLAG]: CHE_OPERATOR_IMAGE,
    [CHE_OPERATOR_CR_PATCH_YAML_FLAG]: CHE_OPERATOR_CR_PATCH_YAML,
    [SKIP_DEV_WORKSPACE_FLAG]: SKIP_DEV_WORKSPACE,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
    [SKIP_VERSION_CHECK_FLAG]: SKIP_VERSION_CHECK,
    [TELEMETRY_FLAG]: TELEMETRY,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    // OLM flags
    [OLM_CHANNEL_FLAG]: OLM_CHANNEL,
    [PACKAGE_MANIFEST_FLAG]: PACKAGE_MANIFEST,
    [CATALOG_SOURCE_NAMESPACE_FLAG]: CATALOG_SOURCE_NAMESPACE,
    [CATALOG_SOURCE_NAME_FLAG]: CATALOG_SOURCE_NAME,
    [CATALOG_SOURCE_YAML_FLAG]: CATALOG_SOURCE_YAML,
    [AUTO_UPDATE_FLAG]: AUTO_UPDATE,
    [STARTING_CSV_FLAG]: STARTING_CSV,
  }

  async run() {
    const { flags } = this.parse(Update)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Update.id, flags })

    if (!flags[BATCH_FLAG] && ctx[CliContext.CLI_IS_CHECTL]) {
      await askForChectlUpdateIfNeeded()
    }

    const eclipseCheInstallerInstaller = EclipseCheInstallerFactory.getInstaller()

    // PreUpdate tasks
    const preUpdateTasks = newListr()
    preUpdateTasks.add(CommonTasks.getTestKubernetesApiTasks())
    preUpdateTasks.add(eclipseCheInstallerInstaller.getPreUpdateTasks())

    // Update tasks
    const updateTasks = newListr()
    updateTasks.add(eclipseCheInstallerInstaller.getUpdateTasks())

    // PostUpdate tasks
    const postUpdateTasks = newListr()
    postUpdateTasks.add(CommonTasks.getPrintHighlightedMessagesTask())

    try {
      this.checkCompatibility(flags)
      await preUpdateTasks.run(ctx)

      if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
        if (!await this.checkAbilityToUpdateCheOperatorAndAskUser(flags)) {
          return
        }
      } else {
        if (!await this.checkAbilityToUpdateCatalogSource(flags)) {
          return
        }
      }

      await updateTasks.run(ctx)
      await postUpdateTasks.run(ctx)
      this.log(getCommandSuccessMessage())
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    if (!flags[BATCH_FLAG]) {
      notifyCommandCompletedSuccessfully()
    }
  }

  private async checkAbilityToUpdateCatalogSource(flags: any): Promise<boolean> {
    const ctx = CheCtlContext.get()
    ctx[EclipseCheContext.UPDATE_CATALOG_SOURCE_AND_SUBSCRIPTION] = false

    const kubeClient = KubeClient.getInstance()
    const subscription = await kubeClient.getOperatorSubscription(EclipseChe.SUBSCRIPTION, ctx[EclipseCheContext.OPERATOR_NAMESPACE])
    if (subscription) {
      if (ctx[EclipseCheContext.CHANNEL] !== subscription.spec.channel ||
        ctx[EclipseCheContext.CATALOG_SOURCE_NAME] !== subscription.spec.source ||
        ctx[EclipseCheContext.CATALOG_SOURCE_NAME] !== subscription.spec.source ||
        ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE] !== subscription.spec.sourceNamespace ||
        ctx[EclipseCheContext.PACKAGE_NAME] !== subscription.spec.name ||
        (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] !== EclipseChe.STABLE_CHANNEL)) {
        cli.info('CatalogSource and Subscription will be updated              :')
        cli.info('-------------------------------------------------------------')
        cli.info(`Current channel                 : ${subscription.spec.channel}`)
        cli.info(`Current catalog source          : ${subscription.spec.source}`)
        cli.info(`Current catalog source namespace: ${subscription.spec.sourceNamespace}`)
        if (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] !== EclipseChe.STABLE_CHANNEL) {
          const catalogSource = await kubeClient.getCatalogSource(subscription.spec.source, subscription.spec.sourceNamespace)
          if (catalogSource) {
            cli.info(`Current catalog source image    : ${catalogSource.spec.image}`)
          }
        }
        cli.info(`Current package name            : ${subscription.spec.name}`)
        ctx[EclipseCheContext.UPDATE_CATALOG_SOURCE_AND_SUBSCRIPTION] = true
      }
    } else {
      cli.info('Subscription will be created  :')
      ctx[EclipseCheContext.UPDATE_CATALOG_SOURCE_AND_SUBSCRIPTION] = true
    }

    if (ctx[EclipseCheContext.UPDATE_CATALOG_SOURCE_AND_SUBSCRIPTION]) {
      cli.info('-------------------------------------------------------------')
      cli.info(`New channel                     : ${ctx[EclipseCheContext.CHANNEL]}`)
      cli.info(`New catalog source              : ${ctx[EclipseCheContext.CATALOG_SOURCE_NAME]}`)
      cli.info(`New catalog source namespace    : ${ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE]}`)
      if (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] !== EclipseChe.STABLE_CHANNEL) {
        cli.info(`New catalog source image        : ${ctx[EclipseCheContext.CATALOG_SOURCE_IMAGE]}`)
      }
      cli.info(`New package name                : ${ctx[EclipseCheContext.PACKAGE_NAME]}`)

      if (!flags[BATCH_FLAG] && !flags[ASSUME_YES_FLAG] && !await cli.confirm('If you want to continue - press Y')) {
        cli.info('Update cancelled by user.')
        return false
      }
    }

    return true
  }

  /**
   * Check whether chectl should proceed with update.
   * Asks user for confirmation (unless assume yes is provided).
   * Is applicable to operator installer only.
   * Returns true if chectl can/should proceed with update, false otherwise.
   */
  private async checkAbilityToUpdateCheOperatorAndAskUser(flags: any): Promise<boolean> {
    const ctx = CheCtlContext.get()
    cli.info(`Existing ${EclipseChe.PRODUCT_NAME} operator: ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE]}`)
    cli.info(`New ${EclipseChe.PRODUCT_NAME} operator     : ${ctx[OperatorImageUpgradeContext.NEW_IMAGE]}`)

    if (ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_NAME] === EclipseChe.OPERATOR_IMAGE_NAME && ctx[OperatorImageUpgradeContext.NEW_IMAGE_NAME] === EclipseChe.OPERATOR_IMAGE_NAME) {
      // Official images

      if (ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE] === ctx[OperatorImageUpgradeContext.NEW_IMAGE]) {
        if (ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG] === EclipseChe.OPERATOR_IMAGE_NEXT_TAG) {
          cli.info(`Updating current ${EclipseChe.PRODUCT_NAME} ${EclipseChe.OPERATOR_IMAGE_NEXT_TAG} version to a new one.`)
          return true
        }

        if (flags[CHE_OPERATOR_CR_PATCH_YAML_FLAG]) {
          // Despite the operator image is the same, CR patch might contain some changes.
          cli.info(`Patching existing ${EclipseChe.PRODUCT_NAME} installation.`)
          return true
        } else {
          cli.info(`${EclipseChe.PRODUCT_NAME} is already up to date.`)
          return false
        }
      }

      if (this.isUpgrade(ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_TAG], ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG])) {
        // Upgrade

        const currentChectlVersion = getProjectVersion()
        if (!ctx[CliContext.CLI_IS_DEV_VERSION] && (ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG] === EclipseChe.OPERATOR_IMAGE_NEXT_TAG || semver.lt(currentChectlVersion, ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG]))) {
          // Upgrade is not allowed
          if (ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG] === EclipseChe.OPERATOR_IMAGE_NEXT_TAG) {
            cli.warn(`Stable ${getProjectName()} cannot update stable ${EclipseChe.PRODUCT_NAME} to ${EclipseChe.OPERATOR_IMAGE_NEXT_TAG} version`)
          } else {
            cli.warn(`It is not possible to update ${EclipseChe.PRODUCT_NAME} to a newer version using the current '${currentChectlVersion}' version of chectl. Please, update '${getProjectName()}' to a newer version using command '${getProjectName()} update' and then try again.`)
          }
          return false
        }

        // Upgrade allowed
        if (ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG] === EclipseChe.OPERATOR_IMAGE_NEXT_TAG) {
          cli.info(`You are going to update ${EclipseChe.PRODUCT_NAME} ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_TAG]} to ${EclipseChe.OPERATOR_IMAGE_NEXT_TAG} version.`)
        } else {
          cli.info(`You are going to update ${EclipseChe.PRODUCT_NAME} ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_TAG]} to ${ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG]}`)
        }
      } else {
        // Downgrade
        cli.error('Downgrading is not supported.')
      }
    } else {
      // At least one of the images is custom

      // Print message
      if (ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE] === ctx[OperatorImageUpgradeContext.NEW_IMAGE]) {
        // Despite the image is the same it could be updated image, replace anyway.
        cli.info(`You are going to replace ${EclipseChe.PRODUCT_NAME} operator image ${ctx[OperatorImageUpgradeContext.NEW_IMAGE]}.`)
      } else if (ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_NAME] !== EclipseChe.OPERATOR_IMAGE_NAME && ctx[OperatorImageUpgradeContext.NEW_IMAGE_NAME] !== EclipseChe.OPERATOR_IMAGE_NAME) {
        // Both images are custom
        cli.info(`You are going to update ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE]} to ${ctx[OperatorImageUpgradeContext.NEW_IMAGE]}`)
      } else {
        // One of the images is offical
        if (ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_NAME] === EclipseChe.OPERATOR_IMAGE_NAME) {
          // Update from offical to custom image
          cli.info(`You are going to update official ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE]} image with user provided one: ${ctx[OperatorImageUpgradeContext.NEW_IMAGE]}`)
        } else { // ctx[OperatorImageUpgradeContext.NEW_IMAGE_NAME] === DEFAULT_CHE_OPERATOR_IMAGE_NAME
          // Update from custom to official image
          cli.info(`You are going to update user provided image ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE]} with official one: ${ctx[OperatorImageUpgradeContext.NEW_IMAGE]}`)
        }
      }
    }

    if (!flags[BATCH_FLAG] && !flags[ASSUME_YES_FLAG] && !await cli.confirm('If you want to continue - press Y')) {
      cli.info('Update cancelled by user.')
      return false
    }

    return true
  }

  /**
   * Checks if official operator image is replaced with a newer one.
   * Tags are allowed in format x.y.z or NEXT_TAG.
   * NEXT_TAG is considered the most recent.
   * For example:
   *  (7.22.1, 7.23.0) -> true,
   *  (7.22.1, 7.20.2) -> false,
   *  (7.22.1, NEXT_TAG) -> true,
   *  (NEXT_TAG, 7.20.2) -> false
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

    // if newTag is NEXT_TAG it is upgrade
    // if oldTag is NEXT_TAG it is downgrade
    // otherwise just compare new and old tags
    // Note, that semver lib doesn't handle text tags and throws an error in case NEXT_TAG is provided for comparation.
    return newTag === EclipseChe.OPERATOR_IMAGE_NEXT_TAG || (oldTag !== EclipseChe.OPERATOR_IMAGE_NEXT_TAG && isUpdate)
  }

  private checkCompatibility(flags: any) {
    const ctx = CheCtlContext.get()

    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      if (flags[STARTING_CSV_FLAG]) {
        this.error(`--${STARTING_CSV_FLAG} flag should be used only for OpenShift platform.`)
      }
      if (flags[CATALOG_SOURCE_YAML_FLAG]) {
        this.error(`--${CATALOG_SOURCE_YAML_FLAG} flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM_CHANNEL_FLAG]) {
        this.error(`--${OLM_CHANNEL_FLAG} flag should be used only for OpenShift platform.`)
      }
      if (flags[PACKAGE_MANIFEST_FLAG]) {
        this.error(`--${PACKAGE_MANIFEST_FLAG} flag should be used only for OpenShift platform.`)
      }
      if (flags[CATALOG_SOURCE_NAME_FLAG]) {
        this.error(`--${CATALOG_SOURCE_NAME_FLAG} flag should be used only for OpenShift platform.`)
      }
      if (flags[CATALOG_SOURCE_NAMESPACE_FLAG]) {
        this.error(`--${CATALOG_SOURCE_NAMESPACE_FLAG} flag should be used only for OpenShift platform.`)
      }
    }
  }
}
