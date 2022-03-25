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
import Listr = require('listr')
import * as os from 'os'
import * as path from 'path'

import { CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_OPERATOR_CR_YAML_KEY, LOG_DIRECTORY_KEY } from '../common-flags'
import { CHECTL_PROJECT_NAME, OPERATOR_TEMPLATE_DIR } from '../constants'
import { getEmbeddedTemplatesDirectory, getProjectName, getProjectVersion, readCRFile, safeLoadFromYamlFile } from '../util'

import { CHECTL_DEVELOPMENT_VERSION } from './version'

/**
 * chectl command context.
 * Can be requested from any location with `ChectlContext#get`
 */
export namespace ChectlContext {
  export const IS_OPENSHIFT = 'isOpenShift'
  export const START_TIME = 'startTime'
  export const END_TIME = 'endTime'
  export const CONFIG_DIR = 'configDir'
  export const CACHE_DIR = 'cacheDir'
  export const ERROR_LOG = 'errorLog'
  export const COMMAND_ID = 'commandId'

  // command specific attributes
  export const CUSTOM_CR = 'customCR'
  export const CR_PATCH = 'crPatch'
  export const DEFAULT_CR = 'defaultCR'
  export const LOGS_DIR = 'directory'

  export const RESOURCES = 'resourcesPath'

  const ctx: any = {}

  export async function init(flags: any, command: Command): Promise<void> {
    ctx.isChectl = getProjectName() === CHECTL_PROJECT_NAME
    ctx.isDevVersion = getProjectVersion().includes('next') || getProjectVersion() === CHECTL_DEVELOPMENT_VERSION
    if (flags['listr-renderer'] as any) {
      ctx.listrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false } as Listr.ListrOptions
    }

    ctx.highlightedMessages = [] as string[]
    ctx[START_TIME] = Date.now()

    ctx[CONFIG_DIR] = command.config.configDir
    ctx[CACHE_DIR] = command.config.cacheDir
    ctx[ERROR_LOG] = command.config.errlog
    ctx[COMMAND_ID] = command.id
    ctx[LOGS_DIR] = path.resolve(flags[LOG_DIRECTORY_KEY] ? flags[LOG_DIRECTORY_KEY] : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))

    ctx[CUSTOM_CR] = readCRFile(flags, CHE_OPERATOR_CR_YAML_KEY)
    ctx[CR_PATCH] = readCRFile(flags, CHE_OPERATOR_CR_PATCH_YAML_KEY)

    if (flags.templates) {
      ctx[RESOURCES] = path.join(flags.templates, OPERATOR_TEMPLATE_DIR)
    } else {
      // Use build-in templates if no custom templates nor version to deploy specified.
      // All flavors should use embedded templates if not custom templates is given.
      ctx[RESOURCES] = path.join(getEmbeddedTemplatesDirectory(), OPERATOR_TEMPLATE_DIR)
    }
    ctx[DEFAULT_CR] = safeLoadFromYamlFile(path.join(ctx.resourcesPath, 'crds', 'org_checluster_cr.yaml'))
    ctx[IS_OPENSHIFT] = await isOpenShift()
  }

  export async function initAndGet(flags: any, command: Command): Promise<any> {
    await init(flags, command)
    return ctx
  }

  export function get(): any {
    return ctx
  }

  function isOpenShift(): Promise<boolean> {
    return IsAPIGroupSupported('apps.openshift.io')
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
}

export namespace OIDCContextKeys {
  export const ISSUER_URL = 'oidc-issuer-url'
  export const CLIENT_ID = 'oidc-client-id'
  export const CA_FILE = 'oidc-ca-file'
}

export namespace DexContextKeys {
  export const DEX_CA_CRT = 'dex-ca.crt'
  export const DEX_USERNAME = 'dex-username'
  export const DEX_PASSWORD = 'dex-password'
  export const DEX_PASSWORD_HASH = 'dex-password-hash'
}

export namespace OLM {
  export const CHANNEL = 'olm-channel'
  export const STARTING_CSV = 'starting-csv'
  export const AUTO_UPDATE = 'auto-update'

  // Custom catalog source
  export const CATALOG_SOURCE_NAME = 'catalog-source-name'
  export const CATALOG_SOURCE_NAMESPACE = 'catalog-source-namespace'
  export const CATALOG_SOURCE_YAML = 'catalog-source-yaml'
  export const PACKAGE_MANIFEST_NAME = 'package-manifest-name'
}

export namespace DevWorkspaceContextKeys {
  export const IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB = 'is-dev-workspace-installed-via-operator-hub'
  export const CATALOG_SOURCE_NAME = 'dev-workspace-catalog-source-name'
  export const INSTALL_PLAN = 'dev-workspace-install-plan'
}

export enum OLMInstallationUpdate {
  MANUAL = 'Manual',
  AUTO = 'Automatic'
}
