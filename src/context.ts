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

import { ApisApi, KubeConfig } from '@kubernetes/client-node'
import Command from '@oclif/command'
import * as os from 'os'
import * as path from 'path'

import {
  AUTO_UPDATE_FLAG, CATALOG_SOURCE_NAME_FLAG, CATALOG_SOURCE_NAMESPACE_FLAG,
  CHE_OPERATOR_CR_PATCH_YAML_FLAG,
  CHE_OPERATOR_CR_YAML_FLAG,
  DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
  DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT,
  DEFAULT_K8S_POD_READY_TIMEOUT,
  DEFAULT_POD_WAIT_TIMEOUT,
  K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG,
  K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG,
  K8S_POD_READY_TIMEOUT_FLAG,
  K8S_POD_WAIT_TIMEOUT_FLAG,
  LOG_DIRECTORY_FLAG, OLM_CHANNEL_FLAG, PACKAGE_MANIFEST_FLAG, STARTING_CSV_FLAG,
  TEMPLATES_FLAG,
} from './flags'
import { getEmbeddedTemplatesDirectory, getProjectVersion, safeLoadFromYamlFile } from './utils/utls'

import {DevWorkspace} from './tasks/installers/dev-workspace/dev-workspace'
import {EclipseChe} from './tasks/installers/eclipse-che/eclipse-che'
import * as fs from 'fs-extra'
import * as execa from 'execa'
import {CHE} from './constants'

export namespace InfrastructureContext {
  export const IS_OPENSHIFT = 'infrastructure-is-openshift'
  export const OPENSHIFT_VERSION = 'infrastructure-openshift-version'
  export const KUBERNETES_VERSION = 'infrastructure-kubernetes-version'
  export const OPENSHIFT_ARCH = 'infrastructure-openshift-arch'
  export const OPENSHIFT_OPERATOR_NAMESPACE = 'openshift-operator-namespace'
  export const OPENSHIFT_MARKETPLACE_NAMESPACE = 'openshift-marketplace-namespace'
}

export namespace CliContext {
  export const CLI_COMMAND_FLAGS = 'cli-command-flags'
  export const CLI_COMMAND_START_TIME = 'cli-command-start-time'
  export const CLI_COMMAND_END_TIME = 'cli-command-end-time'
  export const CLI_COMMAND_ID = 'cli-command-id'
  export const CLI_CONFIG_DIR = 'cli-config-dir'
  export const CLI_CACHE_DIR = 'cli-cache-dir'
  export const CLI_ERROR_LOG = 'cli-error-log'
  export const CLI_COMMAND_LOGS_DIR = 'cli-logs-log'
  export const CLI_IS_DEV_VERSION = 'cli-dev-version'
  export const CLI_IS_CHECTL = 'cli-is-chectl'
  export const CLI_CHE_OPERATOR_RESOURCES_DIR = 'cli-che-operator-resources-dir'
  export const CLI_DEV_WORKSPACE_OPERATOR_RESOURCES_DIR = 'cli-dev-workspace-operator-resources-dir'
  export const CLI_COMMAND_POST_OUTPUT_MESSAGES = 'cli-messages'
}

export namespace OIDCContext {
  export const ISSUER_URL = 'oidc-issuer-url'
  export const CLIENT_ID = 'oidc-client-id'
  export const CA_FILE = 'oidc-ca-file'
}

export namespace DexContext {
  export const DEX_CA_CRT = 'dex-ca.crt'
  export const DEX_USERNAME = 'dex-username'
  export const DEX_PASSWORD = 'dex-password'
  export const DEX_PASSWORD_HASH = 'dex-password-hash'
}

export namespace EclipseCheContext {
  export const CHANNEL = 'eclipse-che-channel'
  export const CATALOG_SOURCE_NAME = 'eclipse-che-catalog-source-name'
  export const CATALOG_SOURCE_IMAGE = 'eclipse-che-catalog-source-image'
  export const CATALOG_SOURCE_NAMESPACE = 'eclipse-che-catalog-source-namespace'
  export const PACKAGE_NAME = 'eclipse-che-package-name'
  export const APPROVAL_STRATEGY = 'eclipse-che-approval-strategy'
  export const CUSTOM_CR = 'eclipse-che-custom-cr'
  export const CR_PATCH = 'eclipse-che-cr-patch'
  export const DEFAULT_CR = 'eclipse-che-default-cr'
}

export namespace DevWorkspaceContext {
  export const CATALOG_SOURCE_NAME = 'dev-workspace-catalog-source-name'
  export const CATALOG_SOURCE_IMAGE = 'dev-workspace-catalog-source-image'
  export const CHANNEL = 'dev-workspace-install-plan'
  export const NAMESPACE = 'dev-workspace-namespace'
}

export namespace KubeHelperContext {
  export const POD_WAIT_TIMEOUT = 'kube-pod-wait-timeout'
  export const POD_READY_TIMEOUT = 'kube-pod-ready-timeout'
  export const POD_DOWNLOAD_IMAGE_TIMEOUT = 'kube-pod-download-image-timeout'
  export const POD_ERROR_RECHECK_TIMEOUT = 'kube-pod-error-recheck-timeout'
}

export namespace OperatorImageUpgradeContext {
  export const NEW_IMAGE = 'operator-image-new'
  export const NEW_IMAGE_NAME = 'operator-image-name-new'
  export const NEW_IMAGE_TAG = 'operator-image-tag-new'
  export const DEPLOYED_IMAGE = 'operator-image-deployed'
  export const DEPLOYED_IMAGE_NAME = 'operator-image-name-deployed'
  export const DEPLOYED_IMAGE_TAG = 'operator-image-tag-deployed'
}

/**
 * chectl command context.
 * Can be requested from any location with `ChectlContext#get`
 */
export namespace CheCtlContext {
  const ctx: any = {}
  const CHE_OPERATOR_TEMPLATE_DIR = `${EclipseChe.CHE_FLAVOR}-operator`
  const DEV_WORKSPACE_OPERATOR_TEMPLATE_DIR = 'devworkspace-operator'

  export async function init(flags: any, command: Command): Promise<void> {
    ctx[CliContext.CLI_COMMAND_FLAGS] = flags
    ctx[CliContext.CLI_IS_CHECTL] = EclipseChe.CHE_FLAVOR === CHE
    ctx[CliContext.CLI_IS_DEV_VERSION] = getProjectVersion().includes('next') || getProjectVersion() === '0.0.2'
    ctx[CliContext.CLI_COMMAND_START_TIME] = Date.now()
    ctx[CliContext.CLI_CONFIG_DIR] = command.config.configDir
    ctx[CliContext.CLI_CACHE_DIR] = command.config.cacheDir
    ctx[CliContext.CLI_ERROR_LOG] = command.config.errlog
    ctx[CliContext.CLI_COMMAND_ID] = command.id
    ctx[CliContext.CLI_COMMAND_LOGS_DIR] = path.resolve(flags[LOG_DIRECTORY_FLAG] ? flags[LOG_DIRECTORY_FLAG] : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
    ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES] = [] as string[]

    if (flags[TEMPLATES_FLAG]) {
      if (path.basename(flags[TEMPLATES_FLAG]) !== CHE_OPERATOR_TEMPLATE_DIR) {
        ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR] = path.join(flags[TEMPLATES_FLAG], CHE_OPERATOR_TEMPLATE_DIR)
        ctx[CliContext.CLI_DEV_WORKSPACE_OPERATOR_RESOURCES_DIR] = path.join(flags[TEMPLATES_FLAG], DEV_WORKSPACE_OPERATOR_TEMPLATE_DIR)
      } else {
        ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR] = flags[TEMPLATES_FLAG]
        ctx[CliContext.CLI_DEV_WORKSPACE_OPERATOR_RESOURCES_DIR] = path.normalize(path.join(flags[TEMPLATES_FLAG], '..', DEV_WORKSPACE_OPERATOR_TEMPLATE_DIR))
      }
    } else {
      // Use build-in templates if neither custom templates no version to deploy specified.
      // All flavors should use embedded templates if not custom templates is given.
      ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR] = path.join(getEmbeddedTemplatesDirectory(), CHE_OPERATOR_TEMPLATE_DIR)
      ctx[CliContext.CLI_DEV_WORKSPACE_OPERATOR_RESOURCES_DIR] = path.join(getEmbeddedTemplatesDirectory(), DEV_WORKSPACE_OPERATOR_TEMPLATE_DIR)
    }

    ctx[InfrastructureContext.IS_OPENSHIFT] = await isOpenShift()
    ctx[InfrastructureContext.OPENSHIFT_MARKETPLACE_NAMESPACE] = 'openshift-marketplace'
    if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
      ctx[InfrastructureContext.OPENSHIFT_ARCH] = await getOpenShiftArch()
      ctx[InfrastructureContext.OPENSHIFT_VERSION] = await getOpenShiftVersion()
      ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE] = 'openshift-operators'
    }
    ctx[InfrastructureContext.KUBERNETES_VERSION] = await getKubernetesVersion(ctx[InfrastructureContext.IS_OPENSHIFT])

    ctx[EclipseCheContext.CUSTOM_CR] = readFile(flags, CHE_OPERATOR_CR_YAML_FLAG)
    ctx[EclipseCheContext.CR_PATCH] = readFile(flags, CHE_OPERATOR_CR_PATCH_YAML_FLAG)
    ctx[EclipseCheContext.DEFAULT_CR] = safeLoadFromYamlFile(path.join(ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR], 'kubernetes', 'crds', 'org_checluster_cr.yaml'))

    if (flags[STARTING_CSV_FLAG]) {
      // Ignore auto-update flag, otherwise it will automatically update to the latest version and 'starting-csv' will not have any effect.
      ctx[EclipseCheContext.APPROVAL_STRATEGY] = EclipseChe.APPROVAL_STRATEGY_MANUAL
    } else {
      ctx[EclipseCheContext.APPROVAL_STRATEGY] = flags[AUTO_UPDATE_FLAG] ? EclipseChe.APPROVAL_STRATEGY_AUTOMATIC : EclipseChe.APPROVAL_STRATEGY_MANUAL
    }

    ctx[EclipseCheContext.CHANNEL] = flags[OLM_CHANNEL_FLAG]
    if (!ctx[EclipseCheContext.CHANNEL]) {
      if (ctx[CliContext.CLI_IS_DEV_VERSION]) {
        ctx[EclipseCheContext.CHANNEL] = EclipseChe.NEXT_CHANNEL
      } else {
        ctx[EclipseCheContext.CHANNEL] = EclipseChe.STABLE_CHANNEL
      }
    }

    ctx[EclipseCheContext.PACKAGE_NAME] = flags[PACKAGE_MANIFEST_FLAG] || EclipseChe.PACKAGE_NAME
    ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE] = flags[CATALOG_SOURCE_NAMESPACE_FLAG] || ctx[InfrastructureContext.OPENSHIFT_MARKETPLACE_NAMESPACE]
    ctx[EclipseCheContext.CATALOG_SOURCE_NAME] = flags[CATALOG_SOURCE_NAME_FLAG]
    if (!ctx[EclipseCheContext.CATALOG_SOURCE_NAME]) {
      if (ctx[EclipseCheContext.CHANNEL] === EclipseChe.STABLE_CHANNEL) {
        ctx[EclipseCheContext.CATALOG_SOURCE_NAME] = EclipseChe.STABLE_CHANNEL_CATALOG_SOURCE
      } else {
        ctx[EclipseCheContext.CATALOG_SOURCE_NAME] = EclipseChe.NEXT_CHANNEL_CATALOG_SOURCE
      }
    }

    if (ctx[EclipseCheContext.CHANNEL] === EclipseChe.STABLE_CHANNEL) {
      ctx[EclipseCheContext.CATALOG_SOURCE_IMAGE] = EclipseChe.STABLE_CATALOG_SOURCE_IMAGE
    } else {
      ctx[EclipseCheContext.CATALOG_SOURCE_IMAGE] = EclipseChe.NEXT_CATALOG_SOURCE_IMAGE
    }

    // DevWorkspaceContext
    if (ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL) {
      ctx[DevWorkspaceContext.CHANNEL] = DevWorkspace.NEXT_CHANNEL
      ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME] = DevWorkspace.NEXT_CHANNEL_CATALOG_SOURCE
      ctx[DevWorkspaceContext.CATALOG_SOURCE_IMAGE] = DevWorkspace.NEXT_CHANNEL_CATALOG_SOURCE_IMAGE
      if (EclipseChe.CHE_FLAVOR !== CHE) {
        // Use the same IIB catalog source
        ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME] = ctx[EclipseCheContext.CATALOG_SOURCE_NAME]
      }
    } else {
      ctx[DevWorkspaceContext.CHANNEL] = DevWorkspace.STABLE_CHANNEL
      ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME] = DevWorkspace.STABLE_CHANNEL_CATALOG_SOURCE
      ctx[DevWorkspaceContext.CATALOG_SOURCE_IMAGE] = DevWorkspace.STABLE_CHANNEL_CATALOG_SOURCE_IMAGE
    }
    ctx[DevWorkspaceContext.NAMESPACE] = ctx[InfrastructureContext.IS_OPENSHIFT] ? ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE] : DevWorkspace.KUBERNETES_NAMESPACE

    // KubeHelperContext
    ctx[KubeHelperContext.POD_WAIT_TIMEOUT] = parseInt(flags[K8S_POD_WAIT_TIMEOUT_FLAG] || DEFAULT_POD_WAIT_TIMEOUT, 10)
    ctx[KubeHelperContext.POD_READY_TIMEOUT] = parseInt(flags[K8S_POD_READY_TIMEOUT_FLAG] || DEFAULT_K8S_POD_READY_TIMEOUT, 10)
    ctx[KubeHelperContext.POD_DOWNLOAD_IMAGE_TIMEOUT] = parseInt(flags[K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG] || DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT, 10)
    ctx[KubeHelperContext.POD_ERROR_RECHECK_TIMEOUT] = parseInt(flags[K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG] || DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT, 10)
  }

  export async function initAndGet(flags: any, command: Command): Promise<any> {
    await init(flags, command)
    return ctx
  }

  export function get(): any {
    return ctx
  }

  export function getFlags(): any {
    return ctx[CliContext.CLI_COMMAND_FLAGS]
  }

  function isOpenShift(): Promise<boolean> {
    return IsAPIGroupSupported('apps.openshift.io')
  }

  async function getKubernetesVersion(isOpenShift: boolean): Promise<string> {
    const { stdout } = await execa(isOpenShift ? 'oc' : 'kubectl', ['version', '-o', 'json'], { timeout: 60000 })
    const versionOutput = JSON.parse(stdout)
    return versionOutput.serverVersion.major + '.' + versionOutput.serverVersion.minor
  }

  async function getOpenShiftVersion(): Promise<string | undefined> {
    const { stdout } = await execa('oc', ['version', '-o', 'json'], { timeout: 60000 })
    const versionOutput = JSON.parse(stdout)
    const version = (versionOutput.openshiftVersion as string).match(new RegExp('^\\d.\\d+'))
    if (version) {
      return version[0]
    }
    return '4.x'
  }

  async function getOpenShiftArch(): Promise<string | undefined> {
    const { stdout } = await execa('oc', ['version', '-o', 'json'], { timeout: 60000 })
    const versionOutput = JSON.parse(stdout)
    return (versionOutput.serverVersion.platform as string).replace('linux/', '').replace('amd64', 'x86_64')
  }

  async function IsAPIGroupSupported(name: string, version?: string): Promise<boolean> {
    const kubeConfig = new KubeConfig()
    kubeConfig.loadFromDefault()

    const k8sCoreApi = kubeConfig.makeApiClient(ApisApi)
    const res = await k8sCoreApi.getAPIVersions()
    if (!res || !res.body || !res.body.groups) {
      return false
    }

    const group = res.body.groups.find(g => g.name === name)
    if (!group) {
      return false
    }

    if (version) {
      return Boolean(group.versions.find(v => v.version === version))
    } else {
      return Boolean(group)
    }
  }

  function readFile(flags: any, key: string): any {
    const filePath = flags[key]
    if (!filePath) {
      return
    }

    if (fs.existsSync(filePath)) {
      return safeLoadFromYamlFile(filePath)
    }

    throw new Error(`Unable to find file defined in the flag '--${key}'`)
  }
}
