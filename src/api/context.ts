/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command'
import Listr = require('listr')
import * as os from 'os'
import * as path from 'path'

import { CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_OPERATOR_CR_YAML_KEY, LOG_DIRECTORY_KEY } from '../common-flags'
import { getProjectName, getProjectVersion, readCRFile } from '../util'

import { CHECTL_DEVELOPMENT_VERSION } from './version'

/**
 * chectl command context.
 * Can be requested from any location with `ChectlContext#get`
 */
export namespace ChectlContext {
  export const IS_OPENSHIFT = 'isOpenShift'
  export const IS_OPENSHIFT4 = 'isOpenShift4'
  export const START_TIME = 'startTime'
  export const END_TIME = 'endTime'
  export const CONFIG_DIR = 'configDir'
  export const CACHE_DIR = 'cacheDir'
  export const ERROR_LOG = 'errorLog'
  export const COMMAND_ID = 'commandId'

  // command specific attributes
  export const CUSTOM_CR = 'customCR'
  export const CR_PATCH = 'crPatch'
  export const LOGS_DIR = 'directory'

  const ctx: any = {}

  export async function initChectlCtx(flags: any, command: Command): Promise<any> {
    ctx.isChectl = getProjectName() === 'chectl'
    ctx.isNightly = getProjectVersion().includes('next') || getProjectVersion() === CHECTL_DEVELOPMENT_VERSION

    ctx.isChectl = getProjectName() === 'chectl'
    ctx.isNightly = getProjectVersion().includes('next') || getProjectVersion() === CHECTL_DEVELOPMENT_VERSION

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

    return ctx
  }

  export function get(): any {
    return ctx
  }
}
