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
import { CertManagerInstaller } from '../../tasks/installers/cert-manager-installer'
import {CheCtlContext, InfrastructureContext} from '../../context'
import { KubeClient } from '../../api/kube-client'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { DexInstaller } from '../../tasks/installers/dex-installer'
import { PlatformTasks } from '../../tasks/platforms/platform-tasks'
import { EclipseCheInstallerFactory } from '../../tasks/installers/eclipse-che/eclipse-che-installer-factory'
import {
  AUTO_UPDATE,
  AUTO_UPDATE_FLAG,
  BATCH,
  BATCH_FLAG,
  CATALOG_SOURCE_NAME,
  CATALOG_SOURCE_NAME_FLAG, CATALOG_SOURCE_NAMESPACE,
  CATALOG_SOURCE_NAMESPACE_FLAG,
  CATALOG_SOURCE_YAML,
  CATALOG_SOURCE_YAML_FLAG,
  CHE_IMAGE,
  CHE_IMAGE_FLAG,
  CHE_NAMESPACE,
  CHE_NAMESPACE_FLAG,
  CHE_OPERATOR_CR_PATCH_YAML,
  CHE_OPERATOR_CR_PATCH_YAML_FLAG,
  CHE_OPERATOR_CR_YAML,
  CHE_OPERATOR_CR_YAML_FLAG, CHE_OPERATOR_IMAGE, CHE_OPERATOR_IMAGE_FLAG,
  CLUSTER_MONITORING,
  CLUSTER_MONITORING_FLAG,
  DEBUG,
  DEBUG_FLAG,
  DEVFILE_REGISTRY_URL,
  DEVFILE_REGISTRY_URL_FLAG,
  DOMAIN,
  DOMAIN_FLAG, INSTALLER, INSTALLER_FLAG,
  K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
  K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG,
  K8S_POD_ERROR_RECHECK_TIMEOUT,
  K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG,
  K8S_POD_READY_TIMEOUT,
  K8S_POD_READY_TIMEOUT_FLAG,
  K8S_POD_WAIT_TIMEOUT,
  K8S_POD_WAIT_TIMEOUT_FLAG,
  LISTR_RENDERER,
  LISTR_RENDERER_FLAG,
  LOG_DIRECTORY,
  LOG_DIRECTORY_FLAG,
  OLM_CHANNEL,
  OLM_CHANNEL_FLAG,
  PACKAGE_MANIFEST,
  PACKAGE_MANIFEST_FLAG, PLATFORM, PLATFORM_FLAG,
  PLUGIN_REGISTRY_URL,
  PLUGIN_REGISTRY_URL_FLAG,
  POSTGRES_PVS_STORAGE_CLASS_NAME,
  POSTGRES_PVS_STORAGE_CLASS_NAME_FLAG,
  SKIP_CERT_MANAGER,
  SKIP_CERT_MANAGER_FLAG,
  SKIP_DEV_WORKSPACE,
  SKIP_DEV_WORKSPACE_FLAG,
  SKIP_KUBE_HEALTHZ_CHECK,
  SKIP_KUBE_HEALTHZ_CHECK_FLAG, SKIP_OIDC_PROVIDER, SKIP_OIDC_PROVIDER_FLAG,
  SKIP_VERSION_CHECK,
  SKIP_VERSION_CHECK_FLAG,
  STARTING_CSV,
  STARTING_CSV_FLAG,
  TELEMETRY,
  TELEMETRY_FLAG,
  TEMPLATES,
  TEMPLATES_FLAG,
  WORKSPACE_PVS_STORAGE_CLASS_NAME,
  WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG,
} from '../../flags'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {
  askForChectlUpdateIfNeeded,
  getCommandSuccessMessage,
  notifyCommandCompletedSuccessfully,
  wrapCommandError,
} from '../../utils/command-utils'
import {CommonTasks} from '../../tasks/common-tasks'
import {CheTasks} from '../../tasks/che-tasks'
import {newListr} from '../../utils/utls'
import {Che} from '../../utils/che'

export default class Deploy extends Command {
  static description = `Deploy ${EclipseChe.PRODUCT_NAME} server`

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [BATCH_FLAG]: BATCH,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [CHE_IMAGE_FLAG]: CHE_IMAGE,
    [TEMPLATES_FLAG]: TEMPLATES,
    [DEVFILE_REGISTRY_URL_FLAG]: DEVFILE_REGISTRY_URL,
    [PLUGIN_REGISTRY_URL_FLAG]: PLUGIN_REGISTRY_URL,
    [K8S_POD_WAIT_TIMEOUT_FLAG]: K8S_POD_WAIT_TIMEOUT,
    [K8S_POD_READY_TIMEOUT_FLAG]: K8S_POD_READY_TIMEOUT,
    [K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG]: K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
    [K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG]: K8S_POD_ERROR_RECHECK_TIMEOUT,
    [LOG_DIRECTORY_FLAG]: LOG_DIRECTORY,
    [PLATFORM_FLAG]: PLATFORM,
    [INSTALLER_FLAG]: INSTALLER,
    [DOMAIN_FLAG]: DOMAIN,
    [DEBUG_FLAG]: DEBUG,
    [CHE_OPERATOR_IMAGE_FLAG]: CHE_OPERATOR_IMAGE,
    [CHE_OPERATOR_CR_YAML_FLAG]: CHE_OPERATOR_CR_YAML,
    [CHE_OPERATOR_CR_PATCH_YAML_FLAG]: CHE_OPERATOR_CR_PATCH_YAML,
    [WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG]: WORKSPACE_PVS_STORAGE_CLASS_NAME,
    [POSTGRES_PVS_STORAGE_CLASS_NAME_FLAG]: POSTGRES_PVS_STORAGE_CLASS_NAME,
    [SKIP_VERSION_CHECK_FLAG]: SKIP_VERSION_CHECK,
    [SKIP_CERT_MANAGER_FLAG]: SKIP_CERT_MANAGER,
    [SKIP_DEV_WORKSPACE_FLAG]: SKIP_DEV_WORKSPACE,
    [SKIP_OIDC_PROVIDER_FLAG]: SKIP_OIDC_PROVIDER,
    [AUTO_UPDATE_FLAG]: AUTO_UPDATE,
    [STARTING_CSV_FLAG]: STARTING_CSV,
    [OLM_CHANNEL_FLAG]: OLM_CHANNEL,
    [PACKAGE_MANIFEST_FLAG]: PACKAGE_MANIFEST,
    [CATALOG_SOURCE_YAML_FLAG]: CATALOG_SOURCE_YAML,
    [CATALOG_SOURCE_NAME_FLAG]: CATALOG_SOURCE_NAME,
    [CATALOG_SOURCE_NAMESPACE_FLAG]: CATALOG_SOURCE_NAMESPACE,
    [CLUSTER_MONITORING_FLAG]: CLUSTER_MONITORING,
    [TELEMETRY_FLAG]: TELEMETRY,
    [SKIP_KUBE_HEALTHZ_CHECK_FLAG]: SKIP_KUBE_HEALTHZ_CHECK,
  }

  private checkCompatibility(flags: any) {
    const ctx = CheCtlContext.get()

    if (flags[DOMAIN_FLAG] && ctx[InfrastructureContext.IS_OPENSHIFT]) {
      this.warn(`--${DOMAIN_FLAG} flag is ignored for OpenShift platform.`)
    }

    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      // Ensure required CheCluster fields are set (k8s platforms)
      if (flags[PLATFORM_FLAG] !== 'minikube') {
        for (const field of [
          'spec.networking.auth.identityProviderURL',
          'spec.networking.auth.oAuthSecret',
          'spec.networking.auth.oAuthClientName',
        ]) {
          if (!Che.getCheClusterFieldConfigured(field)) {
            this.error(getMissedOIDCConfigClusterFieldErrorMsg())
          }
        }
      }

      // Not OLM installer
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
      if (flags[CLUSTER_MONITORING_FLAG]) {
        this.error(`--${CLUSTER_MONITORING_FLAG} flag should be used only for OpenShift platform.`)
      }
    }
  }

  async run() {
    const {flags} = this.parse(Deploy)
    const ctx = await CheCtlContext.initAndGet(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, {command: Deploy.id, flags})

    if (!flags.batch && ctx.isChectl) {
      await askForChectlUpdateIfNeeded()
    }

    // Platform Checks
    const platformTasks = newListr()
    platformTasks.add(PlatformTasks.getPreflightCheckTasks())

    // PreInstall tasks
    const preInstallTasks = newListr()
    preInstallTasks.add(CommonTasks.getTestKubernetesApiTasks())
    preInstallTasks.add(CommonTasks.getOpenShiftVersionTask())

    // Install tasks
    const installTasks = newListr()
    installTasks.add(CommonTasks.getCreateNamespaceTask(flags[CHE_NAMESPACE_FLAG], getNamespaceLabels(flags)))

    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      installTasks.add(new CertManagerInstaller().getDeployTasks())
    }

    if (flags[PLATFORM_FLAG] === 'minikube') {
      installTasks.add(new DexInstaller().getDeployTasks())
    }

    installTasks.add(CheTasks.getServerLogsTasks(true))
    installTasks.add(EclipseCheInstallerFactory.getInstaller().getDeployTasks())

    // PostInstall tasks
    const postInstallTasks = newListr([], false)
    postInstallTasks.add(CheTasks.getWaitCheDeployedTasks())
    postInstallTasks.add(CheTasks.getRetrieveSelfSignedCertificateTask())
    postInstallTasks.add(CommonTasks.getPreparePostInstallationOutputTask())
    postInstallTasks.add(CommonTasks.getPrintHighlightedMessagesTask())

    try {
      this.checkCompatibility(flags)
      await preInstallTasks.run(ctx)

      const kubeHelper = KubeClient.getInstance()
      const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
      if (cheCluster) {
        cli.warn(`${EclipseChe.PRODUCT_NAME} has been already deployed. Use server:start command to start a stopped ${EclipseChe.PRODUCT_NAME} instance.`)
      } else {
        await platformTasks.run(ctx)
        await installTasks.run(ctx)
        await postInstallTasks.run(ctx)
        this.log(getCommandSuccessMessage())
      }
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }

    if (!flags[BATCH_FLAG]) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }
}

function getNamespaceLabels(flags: any): any {
  if (flags[CLUSTER_MONITORING_FLAG] && flags[PLATFORM_FLAG] === 'openshift') {
    return { 'openshift.io/cluster-monitoring': 'true' }
  }
  return {}
}

function getMissedOIDCConfigClusterFieldErrorMsg(): string {
  return `Some required configuration is not specifed in order to deploy ${EclipseChe.PRODUCT_NAME}
on a Kubernetes cluster with an OIDC provider configured. Use the flag '--${CHE_OPERATOR_CR_PATCH_YAML_FLAG} <PATH_TO_PATCH_FILE>' to
provide a CheCluster Custom Resource patch with the needed configuration. Find an example of such a configuration below:

kind: CheCluster
apiVersion: org.eclipse.che/v2
spec:
  networking:
    auth:
      oAuthClientName: "<CLIENT_ID>"
      oAuthSecret: "<CLIENT_SECRET>"
      identityProviderURL: "<ISSUER_URL>"

`
}
