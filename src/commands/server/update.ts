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
import { merge } from 'lodash'
import * as path from 'path'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, cheDeployment, cheNamespace, cheOperatorCRPatchYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_OPERATOR_IMAGE, SUBSCRIPTION_NAME } from '../../constants'
import { getPrintHighlightedMessagesTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandErrorMessage, getCommandSuccessMessage, getImageTag, getLatestChectlVersion, getProjectName, getProjectVersion, notifyCommandCompletedSuccessfully } from '../../util'

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
    flags.chenamespace = await findWorkingNamespace(flags)
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

    if (flags.installer === 'operator') {
      const existedOperatorImage = `${ctx.deployedCheOperatorImage}:${ctx.deployedCheOperatorTag}`
      const newOperatorImage = `${ctx.newCheOperatorImage}:${ctx.newCheOperatorTag}`
      cli.info(`Existed Eclipse Che operator: ${existedOperatorImage}.`)
      cli.info(`New Eclipse Che operator    : ${newOperatorImage}.`)

      const defaultOperatorImageTag = getImageTag(DEFAULT_CHE_OPERATOR_IMAGE)
      const chectlChannel = defaultOperatorImageTag === 'nightly' ? 'next' : 'stable'
      const currentChectlVersion = getProjectVersion()
      const latestChectlVersion = await getLatestChectlVersion(chectlChannel)
      const chectlName = getProjectName()

      // the same version is already installed
      if (newOperatorImage === existedOperatorImage) {
        if (chectlName === 'chectl' && latestChectlVersion) {
          // suggest update chectl first
          if (chectlChannel === 'stable' && currentChectlVersion === latestChectlVersion && !flags[CHE_OPERATOR_CR_PATCH_YAML_KEY]) {
            // same stable version, no patch then nothing to update
            cli.info('Eclipse Che is already up to date.')
            this.exit(0)
          } else if (currentChectlVersion !== latestChectlVersion) {
            cli.warn(`It is not possible to update Eclipse Che to a newer version
using the current '${currentChectlVersion}' version of chectl. Please, update 'chectl'
to a newer version '${latestChectlVersion}' with the command 'chectl update ${chectlChannel}'
and then try again.`)
          }
        } else {
          // downstream project or unknown project
          // no patch file then suggest to update
          if (!flags[CHE_OPERATOR_CR_PATCH_YAML_KEY]) {
            cli.warn(`It is not possible to update Eclipse Che to a newer version
using the current '${currentChectlVersion}' version of '${getProjectName()}'.
Please, update '${getProjectName()}' and then try again.`)
            this.exit(0)
          }
        }
        // custom operator image is used
      } else if (newOperatorImage !== DEFAULT_CHE_OPERATOR_IMAGE) {
        cli.warn(`Eclipse Che operator deployment will be updated with the provided image,
but other Eclipse Che components will be updated to the ${defaultOperatorImageTag} version.
Consider removing '--che-operator-image' to update Eclipse Che operator to the same version.`)
      }

      if (!flags.yes && !await cli.confirm('If you want to continue - press Y')) {
        cli.info('Update cancelled by user.')
        this.exit(0)
      }
    }

    const cheCluster = await kubeHelper.getCheCluster(flags.chenamespace)
    if (cheCluster.spec.server.cheImage
      || cheCluster.spec.server.cheImageTag
      || cheCluster.spec.server.devfileRegistryImage
      || cheCluster.spec.database.postgresImage
      || cheCluster.spec.server.pluginRegistryImage
      || cheCluster.spec.auth.identityProviderImage) {
      let imagesListMsg = ''

      const crPatch = ctx[ChectlContext.CR_PATCH] || {}
      if (cheCluster.spec.server.pluginRegistryImage
        && (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.pluginRegistryImage)) {
        imagesListMsg += `\n - Plugin registry image: ${cheCluster.spec.server.pluginRegistryImage}`
        merge(crPatch, { spec: { server: { pluginRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.devfileRegistryImage
        && (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.devfileRegistryImage)) {
        imagesListMsg += `\n - Devfile registry image: ${cheCluster.spec.server.devfileRegistryImage}`
        merge(crPatch, { spec: { server: { devfileRegistryImage: '' } } })
      }

      if (cheCluster.spec.server.postgresImage
        && (!crPatch.spec || !crPatch.spec.database || !crPatch.spec.database.postgresImage)) {
        imagesListMsg += `\n - Postgres image: ${cheCluster.spec.database.postgresImage}`
        merge(crPatch, { spec: { database: { postgresImage: '' } } })
      }

      if (cheCluster.spec.server.identityProviderImage
        && (!crPatch.spec || !crPatch.spec.auth || !crPatch.spec.auth.identityProviderImage)) {
        imagesListMsg += `\n - Identity provider image: ${cheCluster.spec.auth.identityProviderImage}`
        merge(crPatch, { spec: { auth: { identityProviderImage: '' } } })
      }

      if (cheCluster.spec.server.cheImage
        && (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.cheImage)) {
        imagesListMsg += `\n - Eclipse Che server image name: ${cheCluster.spec.server.cheImage}`
        merge(crPatch, { spec: { server: { cheImage: '' } } })
      }

      if (cheCluster.spec.server.cheImageTag
        && (!crPatch.spec || !crPatch.spec.server || !crPatch.spec.server.cheImageTag)) {
        imagesListMsg += `\n - Eclipse Che server image tag: ${cheCluster.spec.server.cheImageTag}`
        merge(crPatch, { spec: { server: { cheImageTag: '' } } })
      }
      ctx[ChectlContext.CR_PATCH] = crPatch

      if (imagesListMsg) {
        cli.warn(`In order to update Eclipse Che to a newer version the fields defining the images in the '${cheCluster.metadata.name}'
Custom Resource in the '${flags.chenamespace}' namespace will be cleaned up:${imagesListMsg}`)
        if (!flags.yes && !await cli.confirm('If you want to continue - press Y')) {
          cli.info('Update cancelled by user.')
          this.exit(0)
        }
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
