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
import * as Listr from 'listr'
import * as semver from 'semver'

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { batch, cheDeployment, cheDeployVersion, cheNamespace, cheOperatorCRPatchYaml, cheOperatorCRYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_OPERATOR_CR_YAML_KEY, CHE_TELEMETRY, DEPLOY_VERSION_KEY, devWorkspaceControllerNamespace, k8sPodDownloadImageTimeout, K8SPODDOWNLOADIMAGETIMEOUT_KEY, k8sPodErrorRecheckTimeout, K8SPODERRORRECHECKTIMEOUT_KEY, k8sPodReadyTimeout, K8SPODREADYTIMEOUT_KEY, k8sPodWaitTimeout, K8SPODWAITTIMEOUT_KEY, listrRenderer, logsDirectory, LOG_DIRECTORY_KEY, skipKubeHealthzCheck as skipK8sHealthCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_NAMESPACE, DEFAULT_OLM_SUGGESTED_NAMESPACE, DOCS_LINK_INSTALL_RUNNING_CHE_LOCALLY, MIN_CHE_OPERATOR_INSTALLER_VERSION, MIN_HELM_INSTALLER_VERSION, MIN_OLM_INSTALLER_VERSION } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { DevWorkspaceTasks } from '../../tasks/component-installers/devfile-workspace-operator-installer'
import { checkChectlAndCheVersionCompatibility, downloadTemplates, getPrintHighlightedMessagesTask, getRetrieveKeycloakCredentialsTask, retrieveCheCaCertificateTask } from '../../tasks/installers/common-tasks'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { PlatformTasks } from '../../tasks/platforms/platform'
import { askForChectlUpdateIfNeeded, getCommandErrorMessage, getCommandSuccessMessage, getEmbeddedTemplatesDirectory, getProjectName, isKubernetesPlatformFamily, isOpenshiftPlatformFamily, notifyCommandCompletedSuccessfully } from '../../util'

export default class Deploy extends Command {
  static description = 'Deploy Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    batch,
    'listr-renderer': listrRenderer,
    'deployment-name': cheDeployment,
    cheimage: string({
      char: 'i',
      description: 'Eclipse Che server container image',
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      env: 'CHE_TEMPLATES_FOLDER',
      exclusive: [DEPLOY_VERSION_KEY],
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
    [K8SPODWAITTIMEOUT_KEY]: k8sPodWaitTimeout,
    [K8SPODREADYTIMEOUT_KEY]: k8sPodReadyTimeout,
    [K8SPODDOWNLOADIMAGETIMEOUT_KEY]: k8sPodDownloadImageTimeout,
    [K8SPODERRORRECHECKTIMEOUT_KEY]: k8sPodErrorRecheckTimeout,
    [LOG_DIRECTORY_KEY]: logsDirectory,
    multiuser: flags.boolean({
      char: 'm',
      description: 'Starts Eclipse Che in multi-user mode',
      default: false
    }),
    tls: flags.boolean({
      char: 's',
      description: `Deprecated. Enable TLS encryption.
                    Note, this option is turned on by default.
                    To provide own certificate for Kubernetes infrastructure, 'che-tls' secret with TLS certificate must be pre-created in the configured namespace.
                    In case of providing own self-signed certificate 'self-signed-certificate' secret should be also created.
                    For OpenShift, router will use default cluster certificates.
                    Please see the docs how to deploy Eclipse Che on different infrastructures: ${DOCS_LINK_INSTALL_RUNNING_CHE_LOCALLY}`,
      hidden: true
    }),
    'self-signed-cert': flags.boolean({
      description: 'Deprecated. The flag is ignored. Self signed certificates usage is autodetected now.',
      default: false,
      hidden: true
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s (for kubernetes)\", \"openshift\", \"crc (for CodeReady Containers)\", \"microk8s\".',
      options: ['minikube', 'minishift', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
    }),
    installer: string({
      char: 'a',
      description: 'Installer type. If not set, default is "olm" for OpenShift 4.x platform otherwise "operator".',
      options: ['helm', 'operator', 'olm'],
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
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
    }),
    [CHE_OPERATOR_CR_YAML_KEY]: cheOperatorCRYaml,
    [CHE_OPERATOR_CR_PATCH_YAML_KEY]: cheOperatorCRPatchYaml,
    'helm-patch-yaml': string({
      description: `Path to yaml file with Helm Chart values patch.
                    The file format is identical to values.yaml from the chart.
                    Note, Provided command line arguments take precedence over patch file.`,
      default: '',
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
                    By default this flag is enabled.
                    This parameter is used only when the installer is 'olm'.`,
      allowNo: true,
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
    }),
    'package-manifest-name': string({
      description: `Package manifest name to subscribe to Eclipse Che OLM package manifest.
                    This parameter is used only when the installer is the 'olm'.`,
    }),
    'catalog-source-yaml': string({
      description: `Path to a yaml file that describes custom catalog source for installation Eclipse Che operator.
                    Catalog source will be applied to the namespace with Che operator.
                    Also you need define 'olm-channel' name and 'package-manifest-name'.
                    This parameter is used only when the installer is the 'olm'.`,
    }),
    'catalog-source-name': string({
      description: `OLM catalog source to install Eclipse Che operator.
                    This parameter is used only when the installer is the 'olm'.`
    }),
    'catalog-source-namespace': string({
      description: `Namespace for OLM catalog source to install Eclipse Che operator.
                    This parameter is used only when the installer is the 'olm'.`
    }),
    'cluster-monitoring': boolean({
      default: false,
      hidden: true,
      description: `Enable cluster monitoring to scrape Eclipse Che metrics in Prometheus.
                    This parameter is used only when the platform is 'openshift'.`
    }),
    'olm-suggested-namespace': boolean({
      default: true,
      allowNo: true,
      description: `Indicate to deploy Eclipse Che in OLM suggested namespace: '${DEFAULT_OLM_SUGGESTED_NAMESPACE}'.
                    Flag 'chenamespace' is ignored in this case
                    This parameter is used only when the installer is 'olm'.`
    }),
    'skip-kubernetes-health-check': skipK8sHealthCheck,
    'workspace-engine': string({
      description: 'Workspace Engine. If not set, default is "che-server". "dev-workspace" is experimental.',
      options: ['che-server', 'dev-workspace'],
      default: 'che-server',
    }),
    'dev-workspace-controller-namespace': devWorkspaceControllerNamespace,
    telemetry: CHE_TELEMETRY,
    [DEPLOY_VERSION_KEY]: cheDeployVersion,
  }

  async setPlaformDefaults(flags: any, ctx: any): Promise<void> {
    flags.tls = await this.checkTlsMode(ctx)
    if (flags['self-signed-cert']) {
      this.warn('"self-signed-cert" flag is deprecated and has no effect. Autodetection is used instead.')
    }

    if (!flags.installer) {
      await this.setDefaultInstaller(flags, ctx)
      cli.info(`› Installer type is set to: '${flags.installer}'`)
    }

    if (flags.installer === 'olm' && flags['olm-suggested-namespace']) {
      flags.chenamespace = DEFAULT_OLM_SUGGESTED_NAMESPACE
      cli.info(` ❕olm-suggested-namespace flag is turned on. Eclipse Che will be deployed in namespace: ${DEFAULT_OLM_SUGGESTED_NAMESPACE}.`)
    }

    if (!ctx.isChectl && flags.version) {
      // Flavors of chectl should not use upstream repositories, so version flag is not applicable
      this.error(`${getProjectName()} does not support '--version' flag.`)
    }
    if (!flags.templates && !flags.version) {
      // Use build-in templates if no custom templates nor version to deploy specified.
      // All flavors should use embedded templates if not custom templates is given.
      flags.templates = getEmbeddedTemplatesDirectory()
    }
  }

  /**
   * Checks if TLS is disabled via operator custom resource.
   * Returns true if TLS is enabled (or omitted) and false if it is explicitly disabled.
   */
  async checkTlsMode(ctx: any): Promise<boolean> {
    const crPatch = ctx.crPatch
    if (crPatch && crPatch.spec && crPatch.spec.server && crPatch.spec.server.tlsSupport === false) {
      return false
    }

    const customCR = ctx.customCR
    if (customCR && customCR.spec && customCR.spec.server && customCR.spec.server.tlsSupport === false) {
      return false
    }

    return true
  }

  private isDevWorkspaceEnabled(ctx: any): boolean {
    const crPatch = ctx.crPatch
    if (crPatch && crPatch.spec && crPatch.spec.devWorkspace && crPatch.spec.devWorkspace.enable) {
      return true
    }

    const customCR = ctx.customCR
    if (customCR && customCR.spec && customCR.spec.devWorkspace && customCR.spec.devWorkspace.enable) {
      return true
    }

    return false
  }

  private checkCompatibility(flags: any) {
    if (flags.installer === 'operator' && flags[CHE_OPERATOR_CR_YAML_KEY]) {
      const ignoredFlags = []
      flags['plugin-registry-url'] && ignoredFlags.push('--plugin-registry-url')
      flags['devfile-registry-url'] && ignoredFlags.push('--devfile-registry-url')
      flags['postgres-pvc-storage-class-name'] && ignoredFlags.push('--postgres-pvc-storage-class-name')
      flags['workspace-pvc-storage-class-name'] && ignoredFlags.push('--workspace-pvc-storage-class-name')
      flags.tls && ignoredFlags.push('--tls')
      flags.cheimage && ignoredFlags.push('--cheimage')
      flags.debug && ignoredFlags.push('--debug')
      flags.domain && ignoredFlags.push('--domain')
      flags.multiuser && ignoredFlags.push('--multiuser')

      if (ignoredFlags.length) {
        this.warn(`--${CHE_OPERATOR_CR_YAML_KEY} is used. The following flag(s) will be ignored: ${ignoredFlags.join('\t')}`)
      }
    }

    if (flags.domain && !flags[CHE_OPERATOR_CR_YAML_KEY] && isOpenshiftPlatformFamily(flags.platform)) {
      this.warn('"--domain" flag is ignored for Openshift family infrastructures. It should be done on the cluster level.')
    }

    if (flags.installer === 'helm') {
      if (!isKubernetesPlatformFamily(flags.platform) && flags.platform !== 'docker-desktop') {
        this.error(`🛑 Current platform is ${flags.platform}. Helm installer is only available on top of Kubernetes flavor platform (including Minikube, Docker Desktop).`)
      }
    }

    if (flags.installer === 'olm') {
      // OLM installer only checks
      if (flags.platform === 'minishift') {
        this.error(`🛑 The specified installer ${flags.installer} does not support Minishift`)
      }

      if (flags['catalog-source-name'] && flags['catalog-source-yaml']) {
        this.error('should be provided only one argument: "catalog-source-name" or "catalog-source-yaml"')
      }
      if (flags.version) {
        if (flags['starting-csv']) {
          this.error('"starting-csv" and "version" flags are mutually exclusive. Please specify only one of them.')
        }
        if (flags['olm-channel']) {
          this.error('"starting-csv" and "version" flags are mutually exclusive. Use "starting-csv" with "olm-channel" flag.')
        }
        if (flags['auto-update']) {
          this.error('enabled "auto-update" flag cannot be used with version flag. Deploy latest version instead.')
        }
      }

      if (!flags['package-manifest-name'] && flags['catalog-source-yaml']) {
        this.error('you need to define "package-manifest-name" flag to use "catalog-source-yaml".')
      }
      if (!flags['olm-channel'] && flags['catalog-source-yaml']) {
        this.error('you need to define "olm-channel" flag to use "catalog-source-yaml".')
      }
    } else {
      // Not OLM installer
      if (flags['starting-csv']) {
        this.error('"starting-csv" flag should be used only with "olm" installer.')
      }
      if (flags['catalog-source-yaml']) {
        this.error('"catalog-source-yaml" flag should be used only with "olm" installer.')
      }
      if (flags['olm-channel']) {
        this.error('"olm-channel" flag should be used only with "olm" installer.')
      }
      if (flags['package-manifest-name']) {
        this.error('"package-manifest-name" flag should be used only with "olm" installer.')
      }
      if (flags['catalog-source-name']) {
        this.error('"catalog-source-name" flag should be used only with "olm" installer.')
      }
      if (flags['catalog-source-namespace']) {
        this.error('"package-manifest-name" flag should be used only with "olm" installer.')
      }
      if (flags['cluster-monitoring'] && flags.platform !== 'openshift') {
        this.error('"cluster-monitoring" flag should be used only with "olm" installer and "openshift" platform.')
      }
    }

    if (flags.version) {
      // Check minimal allowed version to install
      let minAllowedVersion: string
      switch (flags.installer) {
      case 'olm':
        minAllowedVersion = MIN_OLM_INSTALLER_VERSION
        break
      case 'operator':
        minAllowedVersion = MIN_CHE_OPERATOR_INSTALLER_VERSION
        break
      case 'helm':
        minAllowedVersion = MIN_HELM_INSTALLER_VERSION
        break
      default:
        // Should never happen
        minAllowedVersion = 'latest'
      }

      if (semver.gt(minAllowedVersion, flags.version)) {
        throw new Error(`This chectl version can deploy version ${minAllowedVersion} and higher. If you need to deploy ${flags.version} or lower, download the corresponding legacy chectl version.`)
      }
    }
  }

  async run() {
    const { flags } = this.parse(Deploy)
    flags.chenamespace = flags.chenamespace || DEFAULT_CHE_NAMESPACE
    const ctx = await ChectlContext.initAndGet(flags, this)

    if (!flags.batch && ctx.isChectl) {
      await askForChectlUpdateIfNeeded()
    }

    await this.setPlaformDefaults(flags, ctx)
    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Deploy.id, flags })

    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks()
    const installerTasks = new InstallerTasks()
    const apiTasks = new ApiTasks()
    const devWorkspaceTasks = new DevWorkspaceTasks(flags)

    // Platform Checks
    let platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), ctx.listrOptions)

    // Checks if Eclipse Che is already deployed
    let preInstallTasks = new Listr(undefined, ctx.listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing Eclipse Che instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })
    preInstallTasks.add(checkChectlAndCheVersionCompatibility(flags))
    preInstallTasks.add(downloadTemplates(flags))
    preInstallTasks.add({
      title: '🧪  DevWorkspace engine (experimental / technology preview) 🚨',
      enabled: () => (this.isDevWorkspaceEnabled(ctx) || flags['workspace-engine'] === 'dev-workspace') && !ctx.isOpenShift,
      task: () => new Listr(devWorkspaceTasks.getInstallTasks(flags))
    })
    let installTasks = new Listr(installerTasks.installTasks(flags, this), ctx.listrOptions)

    // Post Install Checks
    const postInstallTasks = new Listr([
      {
        title: '✅  Post installation checklist',
        task: () => new Listr(cheTasks.waitDeployedChe())
      },
      getRetrieveKeycloakCredentialsTask(flags),
      retrieveCheCaCertificateTask(flags),
      ...cheTasks.preparePostInstallationOutput(flags),
      getPrintHighlightedMessagesTask(),
    ], ctx.listrOptions)

    const logsTasks = new Listr([{
      title: 'Following Eclipse Che logs',
      task: () => new Listr(cheTasks.serverLogsTasks(flags, true))
    }], ctx.listrOptions)

    try {
      await preInstallTasks.run(ctx)

      if (ctx.isCheDeployed) {
        let message = 'Eclipse Che has been already deployed.'
        if (!ctx.isCheReady) {
          message += ' Use server:start command to start a stopped Eclipse Che instance.'
        }
        cli.warn(message)
      } else {
        this.checkCompatibility(flags)
        await platformCheckTasks.run(ctx)
        await logsTasks.run(ctx)
        await installTasks.run(ctx)
        await postInstallTasks.run(ctx)
        this.log(getCommandSuccessMessage())
      }
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }

    notifyCommandCompletedSuccessfully()
    this.exit(0)
  }

  /**
   * Sets default installer which is `olm` for OpenShift 4 with stable version of chectl
   * and `operator` for other cases.
   */
  async setDefaultInstaller(flags: any, _ctx: any): Promise<void> {
    const kubeHelper = new KubeHelper(flags)

    const isOlmPreinstalled = await kubeHelper.isPreInstalledOLM()
    if ((flags['catalog-source-name'] || flags['catalog-source-yaml']) && isOlmPreinstalled) {
      flags.installer = 'olm'
      return
    }

    if (flags.platform === 'openshift' && await kubeHelper.isOpenShift4() && isOlmPreinstalled) {
      flags.installer = 'olm'
    } else {
      flags.installer = 'operator'
    }
  }
}
