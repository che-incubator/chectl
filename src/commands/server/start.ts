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
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as os from 'os'
import * as path from 'path'

import { KubeHelper } from '../../api/kube'
import { cheDeployment, cheNamespace, listrRenderer, skipKubeHealthzCheck as skipK8sHealthCheck } from '../../common-flags'
import { DEFAULT_CHE_IMAGE, DEFAULT_CHE_OPERATOR_IMAGE, DOCS_LINK_INSTALL_TLS_WITH_SELF_SIGNED_CERT } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { getPrintHighlightedMessagesTask, getRetrieveKeycloakCredentialsTask, retrieveCheCaCertificateTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { CommonPlatformTasks } from '../../tasks/platforms/common-platform-tasks'
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
                    Please see docs for more details: ${DOCS_LINK_INSTALL_TLS_WITH_SELF_SIGNED_CERT}`
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
      default: false,
      exclusive: ['starting-csv']
    }),
    'starting-csv': flags.string({
      description: `Starting cluster service version(CSV) for installation Eclipse Che.
                    Flags uses to set up start installation version Che.
                    For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
                    Then OLM will install Eclipse Che with version 7.10.0.
                    Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known version.
                    This parameter is used only when the installer is 'olm'.`
    }),
    'olm-channel': string({
      description: `Olm channel to install Eclipse Che, f.e. stable.
                    If options was not set, will be used default version for package manifest.
                    This parameter is used only when the installer is the 'olm'.`,
      dependsOn: ['catalog-source-yaml']
    }),
    'package-manifest-name': string({
      description: `Package manifest name to subscribe to Eclipse Che OLM package manifest.
                    This parameter is used only when the installer is the 'olm'.`,
      dependsOn: ['catalog-source-yaml']
    }),
    'catalog-source-yaml': string({
      description: `Path to a yaml file that describes custom catalog source for installation Eclipse Che operator.
                    Catalog source will be applied to the namespace with Che operator.
                    Also you need define 'olm-channel' name and 'package-manifest-name'.
                    This parameter is used only when the installer is the 'olm'.`,
    }),
    'skip-kubernetes-health-check': skipK8sHealthCheck
  }

  async setPlaformDefaults(flags: any): Promise<void> {
    flags.tls = await this.checkTlsMode(flags)

    if (!flags.installer) {
      await this.setDefaultInstaller(flags)
    }

    if (!flags.templates) {
      // use local templates folder if present
      const templates = 'templates'
      const templatesDir = path.resolve(templates)
      if (flags.installer === 'operator') {
        if (fs.pathExistsSync(`${templatesDir}/che-operator`)) {
          flags.templates = templatesDir
        }
      } else if (flags.installer === 'minishift-addon') {
        if (fs.pathExistsSync(`${templatesDir}/minishift-addon/`)) {
          flags.templates = templatesDir
        }
      }

      if (!flags.templates) {
        flags.templates = path.join(__dirname, '../../../templates')
      }
    }
  }

  /**
   * Checks if TLS is disabled via operator custom resource.
   * Returns true if TLS is enabled (or omitted) and false if it is explicitly disabled.
   */
  async checkTlsMode(flags: any): Promise<boolean> {
    if (flags['che-operator-cr-patch-yaml']) {
      const cheOperatorCrPatchYamlPath = flags['che-operator-cr-patch-yaml']
      if (fs.existsSync(cheOperatorCrPatchYamlPath)) {
        const crPatch = yaml.safeLoad(fs.readFileSync(cheOperatorCrPatchYamlPath).toString())
        if (crPatch && crPatch.spec && crPatch.spec.server && crPatch.spec.server.tlsSupport === false) {
          return false
        }
      }
    }

    if (flags['che-operator-cr-yaml']) {
      const cheOperatorCrYamlPath = flags['che-operator-cr-yaml']
      if (fs.existsSync(cheOperatorCrYamlPath)) {
        const cr = yaml.safeLoad(fs.readFileSync(cheOperatorCrYamlPath).toString())
        if (cr && cr.spec && cr.spec.server && cr.spec.server.tlsSupport === false) {
          return false
        }
      }
    }

    return true
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
      if (flags.installer !== 'olm' && flags['catalog-source-yaml']) {
        this.error('"catalog-source-yaml" flag should be used only with "olm" installer.')
      }
      if (flags.installer !== 'olm' && flags['olm-channel']) {
        this.error('"olm-channel" flag should be used only with "olm" installer.')
      }
      if (flags.installer !== 'olm' && flags['package-manifest-name']) {
        this.error('"package-manifest-name" flag should be used only with "olm" installer.')
      }

      if (!flags['package-manifest-name'] && flags['catalog-source-yaml']) {
        this.error('you need define "package-manifest-name" flag to use "catalog-source-yaml".')
      }
      if (!flags['olm-channel'] && flags['catalog-source-yaml']) {
        this.error('you need define "olm-channel" flag to use "catalog-source-yaml".')
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
    platformCheckTasks.add(CommonPlatformTasks.oAuthProvidersExists(flags))

    // Checks if Eclipse Che is already deployed
    let preInstallTasks = new Listr(undefined, listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing Eclipse Che instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })

    await this.setPlaformDefaults(flags)
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
      getRetrieveKeycloakCredentialsTask(flags),
      retrieveCheCaCertificateTask(flags),
      getPrintHighlightedMessagesTask(),
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

  /**
   * Sets default installer which is `olm` for OpenShift 4 with stable version of chectl
   * and `operator` for other cases.
   */
  async setDefaultInstaller(flags: any): Promise<void> {
    const cheVersion = DEFAULT_CHE_OPERATOR_IMAGE.split(':')[1]
    const kubeHelper = new KubeHelper(flags)
    if (flags.platform === 'openshift' && await kubeHelper.isOpenShift4() && cheVersion !== 'nightly' && cheVersion !== 'latest') {
      flags.installer = 'olm'
    } else {
      flags.installer = 'operator'
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }
  }
}
