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
import { boolean, string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as Listr from 'listr'
import { CertManagerTasks } from '../../tasks/components/cert-manager'
import { ChectlContext, OIDCContextKeys, OLM } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { batch, cheDeployVersion, cheNamespace, cheOperatorCRPatchYaml, cheOperatorCRYaml, CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_OPERATOR_CR_YAML_KEY, CHE_TELEMETRY, DEPLOY_VERSION_KEY, k8sPodDownloadImageTimeout, K8SPODDOWNLOADIMAGETIMEOUT_KEY, k8sPodErrorRecheckTimeout, K8SPODERRORRECHECKTIMEOUT_KEY, k8sPodReadyTimeout, K8SPODREADYTIMEOUT_KEY, k8sPodWaitTimeout, K8SPODWAITTIMEOUT_KEY, listrRenderer, logsDirectory, LOG_DIRECTORY_KEY, skipKubeHealthzCheck as skipK8sHealthCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_NAMESPACE, DOC_LINK_CONFIGURE_API_SERVER } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { DexTasks } from '../../tasks/components/dex'
import {
  createNamespaceTask,
  getPrintHighlightedMessagesTask,
  retrieveCheCaCertificateTask,
} from '../../tasks/installers/common-tasks'
import { ApiTasks } from '../../tasks/platforms/api'
import { PlatformTasks } from '../../tasks/platforms/platform'
import { askForChectlUpdateIfNeeded, getCommandSuccessMessage, getWarnVersionFlagMsg, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'
import { InstallerFactoryTasks } from '../../tasks/installers/installer-factory-tasks'
import { DevWorkspaceTasks } from '../../tasks/components/devworkspace-operator-installer'

export default class Deploy extends Command {
  static description = 'Deploy Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    batch,
    'listr-renderer': listrRenderer,
    cheimage: string({
      char: 'i',
      description: 'Eclipse Che server container image',
      env: 'CHE_CONTAINER_IMAGE',
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      env: 'CHE_TEMPLATES_FOLDER',
      exclusive: [DEPLOY_VERSION_KEY],
    }),
    'devfile-registry-url': string({
      description: 'The URL of the external Devfile registry.',
      env: 'CHE_WORKSPACE_DEVFILE__REGISTRY__URL',
    }),
    'plugin-registry-url': string({
      description: 'The URL of the external plugin registry.',
      env: 'CHE_WORKSPACE_PLUGIN__REGISTRY__URL',
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Eclipse Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT',
    }),
    [K8SPODWAITTIMEOUT_KEY]: k8sPodWaitTimeout,
    [K8SPODREADYTIMEOUT_KEY]: k8sPodReadyTimeout,
    [K8SPODDOWNLOADIMAGETIMEOUT_KEY]: k8sPodDownloadImageTimeout,
    [K8SPODERRORRECHECKTIMEOUT_KEY]: k8sPodErrorRecheckTimeout,
    [LOG_DIRECTORY_KEY]: logsDirectory,
    multiuser: flags.boolean({
      char: 'm',
      description: 'Deprecated. The flag is ignored. Eclipse Che is always deployed in multi-user mode.',
      default: false,
      hidden: true,
    }),
    'self-signed-cert': flags.boolean({
      description: 'Deprecated. The flag is ignored. Self signed certificates usage is autodetected now.',
      default: false,
      hidden: true,
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform.',
      options: ['minikube', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
      required: true,
    }),
    installer: string({
      char: 'a',
      description: 'Installer type. If not set, default is "olm" for OpenShift 4.x platform otherwise "operator".',
      options: ['operator', 'olm'],
      hidden: true,
    }),
    domain: string({
      char: 'b',
      description: `Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)
                    This flag makes sense only for Kubernetes family infrastructures and will be autodetected for Minikube and MicroK8s in most cases.
                    However, for Kubernetes cluster it is required to specify.
                    Please note, that just setting this flag will not likely work out of the box.
                    According changes should be done in Kubernetes cluster configuration as well.
                    In case of Openshift, domain adjustment should be done on the cluster configuration level.`,
      default: '',
    }),
    debug: boolean({
      description: 'Enables the debug mode for Eclipse Che server. To debug Eclipse Che server from localhost use \'server:debug\' command.',
      default: false,
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator or OLM.',
    }),
    [CHE_OPERATOR_CR_YAML_KEY]: cheOperatorCRYaml,
    [CHE_OPERATOR_CR_PATCH_YAML_KEY]: cheOperatorCRPatchYaml,
    'workspace-pvc-storage-class-name': string({
      description: 'persistent volume(s) storage class name to use to store Eclipse Che workspaces data',
      env: 'CHE_INFRA_KUBERNETES_PVC_STORAGE__CLASS__NAME',
      default: '',
    }),
    'postgres-pvc-storage-class-name': string({
      description: 'persistent volume storage class name to use to store Eclipse Che postgres database',
      default: '',
    }),
    'skip-version-check': flags.boolean({
      description: 'Skip minimal versions check.',
      default: false,
    }),
    'skip-cluster-availability-check': flags.boolean({
      description: 'Skip cluster availability check. The check is a simple request to ensure the cluster is reachable.',
      default: false,
    }),
    'skip-oidc-provider-check': flags.boolean({
      description: 'Skip OIDC Provider check',
      default: false,
    }),
    'auto-update': flags.boolean({
      description: `Auto update approval strategy for installation Eclipse Che.
                    With this strategy will be provided auto-update Eclipse Che without any human interaction.
                    By default this flag is enabled.
                    This parameter is used only when the installer is 'olm'.`,
      allowNo: true,
      default: true,
      exclusive: ['starting-csv'],
    }),
    'starting-csv': flags.string({
      description: `Starting cluster service version(CSV) for installation Eclipse Che.
                    Flags uses to set up start installation version Che.
                    For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
                    Then OLM will install Eclipse Che with version 7.10.0.
                    Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known version.
                    This parameter is used only when the installer is 'olm'.`,
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
      exclusive: ['catalog-source-name', 'catalog-source-namespace'],
      dependsOn: ['olm-channel', 'package-manifest-name'],
    }),
    'catalog-source-name': string({
      description: `OLM catalog source to install Eclipse Che operator.
                    This parameter is used only when the installer is the 'olm'.`,
      dependsOn: ['catalog-source-namespace'],
      exclusive: ['catalog-source-yaml'],
    }),
    'catalog-source-namespace': string({
      description: `Namespace for OLM catalog source to install Eclipse Che operator.
                    This parameter is used only when the installer is the 'olm'.`,
      dependsOn: ['catalog-source-name'],
      exclusive: ['catalog-source-yaml'],
    }),
    'cluster-monitoring': boolean({
      default: false,
      hidden: true,
      description: `Enable cluster monitoring to scrape Eclipse Che metrics in Prometheus.
                    This parameter is used only when the platform is 'openshift'.`,
    }),
    'skip-kubernetes-health-check': skipK8sHealthCheck,
    'skip-cert-manager': boolean({
      default: false,
      description: 'Skip installing Cert Manager (Kubernetes cluster only).',
    }),
    'skip-devworkspace-operator': boolean({
      default: false,
      description: 'Skip installing Dev Workspace Operator (Kubernetes cluster only).',
    }),

    telemetry: CHE_TELEMETRY,
    [DEPLOY_VERSION_KEY]: cheDeployVersion,
  }

  private checkCompatibility(flags: any) {
    const ctx = ChectlContext.get()

    if (flags.installer === 'operator' && ctx[ChectlContext.IS_OPENSHIFT]) {
      cli.error('--installer=operator is not supported for OpenShift platform.')
    }

    if (flags.installer === 'olm' && !ctx[ChectlContext.IS_OPENSHIFT]) {
      cli.error('--installer=operator is not supported for Kubernetes platform.')
    }

    if (flags[CHE_OPERATOR_CR_YAML_KEY]) {
      const ignoredFlags = []
      flags['plugin-registry-url'] && ignoredFlags.push('--plugin-registry-url')
      flags['devfile-registry-url'] && ignoredFlags.push('--devfile-registry-url')
      flags['postgres-pvc-storage-class-name'] && ignoredFlags.push('--postgres-pvc-storage-class-name')
      flags['workspace-pvc-storage-class-name'] && ignoredFlags.push('--workspace-pvc-storage-class-name')
      flags.cheimage && ignoredFlags.push('--cheimage')
      flags.debug && ignoredFlags.push('--debug')
      flags.domain && ignoredFlags.push('--domain')

      if (ignoredFlags.length) {
        this.warn(`--${CHE_OPERATOR_CR_YAML_KEY} is used. The following flag(s) will be ignored: ${ignoredFlags.join('\t')}`)
      }
    }

    if (flags.domain && ctx[ChectlContext.IS_OPENSHIFT]) {
      this.warn('--domain flag is ignored for OpenShift platform.')
    }

    if (!ctx[ChectlContext.IS_OPENSHIFT]) {
      // Not OLM installer
      if (flags[OLM.STARTING_CSV]) {
        this.error(`"${OLM.STARTING_CSV}" flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM.CATALOG_SOURCE_YAML]) {
        this.error(`"${OLM.CATALOG_SOURCE_YAML}" flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM.CHANNEL]) {
        this.error(`"${OLM.CHANNEL}" flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM.PACKAGE_MANIFEST_NAME]) {
        this.error(`"${OLM.PACKAGE_MANIFEST_NAME}" flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM.CATALOG_SOURCE_NAME]) {
        this.error(`"${OLM.CATALOG_SOURCE_NAME}" flag should be used only for OpenShift platform.`)
      }
      if (flags[OLM.CATALOG_SOURCE_NAMESPACE]) {
        this.error(`"${OLM.CATALOG_SOURCE_NAMESPACE}" flag should be used only for OpenShift platform.`)
      }
      if (flags['cluster-monitoring']) {
        this.error('"cluster-monitoring" flag should be used only for OpenShift platform.')
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

    if (flags.version) {
      cli.info(getWarnVersionFlagMsg(flags))
      this.exit(1)
    }

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Deploy.id, flags })

    const dexTasks = new DexTasks(flags)
    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks(flags)
    const installerTasks = new InstallerFactoryTasks()
    const apiTasks = new ApiTasks()
    const certManagerTask = new CertManagerTasks(flags)
    const devWorkspaceTask = new DevWorkspaceTasks(flags)

    // Platform Checks
    const platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), ctx.listrOptions)

    // Checks if Eclipse Che is already deployed
    const preInstallTasks = new Listr(undefined, ctx.listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags))
    preInstallTasks.add({
      title: 'Looking for an already existing Eclipse Che instance',
      task: () => new Listr(cheTasks.getCheckIfCheIsInstalledTasks(flags)),
    })
    preInstallTasks.add(ensureOIDCProviderInstalled(flags))

    const installTasks = new Listr(undefined, ctx.listrOptions)
    if (!ctx[ChectlContext.IS_OPENSHIFT]) {
      installTasks.add(certManagerTask.getDeployCertManagerTasks())
      installTasks.add(devWorkspaceTask.getInstallTasks())
    }
    installTasks.add([createNamespaceTask(flags.chenamespace, this.getNamespaceLabels(flags))])
    if (flags.platform === 'minikube') {
      installTasks.add(dexTasks.getInstallTasks())
    }
    installTasks.add({
      title: 'Deploy Eclipse Che',
      task: () => new Listr(installerTasks.getDeployTasks(flags), ctx.listrOptions),
    })

    // Post Install Checks
    const postInstallTasks = new Listr(undefined, ctx.listrOptions)
    postInstallTasks.add(
      {
        title: 'Post installation checklist',
        task: () => new Listr(cheTasks.getWaitCheDeployedTasks()),
      },
    )
    if (flags.platform === 'minikube') {
      postInstallTasks.add(devWorkspaceTask.createOrUpdateDevWorkspaceOperatorConfigTasks())
    }
    postInstallTasks.add(retrieveCheCaCertificateTask(flags))
    postInstallTasks.add(cheTasks.getPreparePostInstallationOutputTasks(flags))
    postInstallTasks.add(getPrintHighlightedMessagesTask())

    const logsTasks = new Listr([{
      title: 'Following Eclipse Che logs',
      task: () => new Listr(cheTasks.getServerLogsTasks(flags, true)),
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
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }

  private getNamespaceLabels(flags: any): any {
    // The label values must be strings
    if (flags['cluster-monitoring'] && flags.platform === 'openshift') {
      return { 'openshift.io/cluster-monitoring': 'true' }
    }
    return {}
  }
}

function ensureOIDCProviderInstalled(flags: any): Listr.ListrTask {
  return {
    title: 'Check if OIDC Provider installed',
    enabled: ctx => !flags['skip-oidc-provider-check'] && !ctx[ChectlContext.IS_OPENSHIFT] && !ctx.isCheDeployed,
    skip: () => {
      if (flags.platform === 'minikube') {
        return 'Dex will be automatically installed as OIDC Identity Provider'
      }
    },
    task: async (_ctx: any, task: any) => {
      const kube = new KubeHelper(flags)
      const apiServerPods = await kube.getPodListByLabel('kube-system', 'component=kube-apiserver')
      for (const pod of apiServerPods) {
        if (!pod.spec) {
          continue
        }
        for (const container of pod.spec.containers) {
          if (container.command) {
            if (container.command.some(value => value.includes(OIDCContextKeys.ISSUER_URL)) && container.command.some(value => value.includes(OIDCContextKeys.CLIENT_ID))) {
              task.title = `${task.title}...[OK]`
              return
            }
          }

          if (container.args) {
            if (container.args.some(value => value.includes(OIDCContextKeys.ISSUER_URL)) && container.args.some(value => value.includes(OIDCContextKeys.CLIENT_ID))) {
              task.title = `${task.title}...[OK]`
              return
            }
          }
        }
      }
      task.title = `${task.title}...[Not Found]`
      throw new Error(`API server is not configured with OIDC Identity Provider, see details ${DOC_LINK_CONFIGURE_API_SERVER}. To bypass OIDC Provider check, use \'--skip-oidc-provider-check\' flag`)
    },
  }
}
