/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'
import Listr = require('listr')
import * as os from 'os'
import * as path from 'path'

import { KubeHelper } from './api/kube'
import { CHE_OPERATOR_CR_PATCH_YAML_KEY, CHE_OPERATOR_CR_YAML_KEY } from './common-flags'
import { DEFAULT_CHE_OPERATOR_IMAGE } from './constants'

export const KUBERNETES_CLI = 'kubectl'
export const OPENSHIFT_CLI = 'oc'

export function getClusterClientCommand(): string {
  const clusterClients = [KUBERNETES_CLI, OPENSHIFT_CLI]
  for (const command of clusterClients) {
    if (commandExists.sync(command)) {
      return command
    }
  }

  throw new Error('No cluster CLI client is installed.')
}

export function isKubernetesPlatformFamily(platform: string): boolean {
  return platform === 'k8s' || platform === 'minikube' || platform === 'microk8s'
}

export function isOpenshiftPlatformFamily(platform: string): boolean {
  return platform === 'openshift' || platform === 'minishift' || platform === 'crc'
}

export function generatePassword(passwodLength: number, charactersSet = '') {
  let dictionary: string[]
  if (!charactersSet) {
    const ZERO_CHAR_CODE = 48
    const NINE_CHAR_CODE = 57
    const A_CHAR_CODE = 65
    const Z_CHAR_CODE = 90
    const a_CHAR_CODE = 97
    const z_CHAR_CODE = 122
    const ranges = [[ZERO_CHAR_CODE, NINE_CHAR_CODE], [A_CHAR_CODE, Z_CHAR_CODE], [a_CHAR_CODE, z_CHAR_CODE]]

    dictionary = []
    for (let range of ranges) {
      for (let charCode = range[0]; charCode <= range[1]; charCode++) {
        dictionary.push(String.fromCharCode(charCode))
      }
    }
  } else {
    dictionary = [...charactersSet]
  }

  let generatedPassword = ''
  for (let i = 0; i < passwodLength; i++) {
    const randomIndex = Math.floor(Math.random() * dictionary.length)
    generatedPassword += dictionary[randomIndex]
  }
  return generatedPassword
}

export function base64Decode(arg: string): string {
  return Buffer.from(arg, 'base64').toString('ascii')
}

/**
 * Indicates if stable version of `chectl` is used.
 */
export function isStableVersion(flags: any): boolean {
  const operatorImage = flags['che-operator-image'] || DEFAULT_CHE_OPERATOR_IMAGE
  const cheVersion = getImageTag(operatorImage)
  return cheVersion !== 'nightly' && cheVersion !== 'latest' && !flags['catalog-source-yaml'] && !flags['catalog-source-name']
}

/**
 * Returns the tag of the image.
 */
export function getImageTag(image: string): string | undefined {
  let entries = image.split('@')
  if (entries.length === 2) {
    // digest
    return entries[1]
  }

  entries = image.split(':')
  // tag
  return entries[1]
}

export function sleep(ms: number): Promise<void> {
  // tslint:disable-next-line no-string-based-set-timeout
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Initialize command context.
 */
export async function initializeContext(flags?: any): Promise<any> {
  const kube = new KubeHelper(flags)
  const ctx: any = {}
  ctx.isOpenShift = await kube.isOpenShift()
  ctx.isOpenShift4 = await kube.isOpenShift4()
  ctx.highlightedMessages = [] as string[]
  ctx.startTime = Date.now()
  ctx.customCR = readCRFile(flags, CHE_OPERATOR_CR_YAML_KEY)
  ctx.crPatch = readCRFile(flags, CHE_OPERATOR_CR_PATCH_YAML_KEY)
  ctx.directory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))
  if (flags['listr-renderer'] as any) {
    ctx.listrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false } as Listr.ListrOptions
  }
  return ctx
}

/**
 * Returns CR file content. Throws an error, if file doesn't exist.
 * @param flags - parent command flags
 * @param CRKey - key for CR file flag
 * @param command - parent command
 */
export function readCRFile(flags: any, CRKey: string): any {
  const CRFilePath = flags[CRKey]
  if (!CRFilePath) {
    return
  }

  if (fs.existsSync(CRFilePath)) {
    return yaml.safeLoad(fs.readFileSync(CRFilePath).toString())
  }

  throw new Error(`Unable to find file defined in the flag '--${CRKey}'`)
}

/**
 * Returns command success message with execution time.
 */
export function getCommandSuccessMessage(command: Command, ctx: any): string {
  if (ctx.startTime) {
    if (!ctx.endTime) {
      ctx.endTime = Date.now()
    }

    const workingTimeInSeconds = Math.round((ctx.endTime - ctx.startTime) / 1000)
    const minutes = Math.floor(workingTimeInSeconds / 60)
    const seconds = (workingTimeInSeconds - minutes * 60) % 60
    const minutesToStr = minutes.toLocaleString([], { minimumIntegerDigits: 2 })
    const secondsToStr = seconds.toLocaleString([], { minimumIntegerDigits: 2 })
    return `Command ${command.id} has completed successfully in ${minutesToStr}:${secondsToStr}.`
  }

  return `Command ${command.id} has completed successfully.`
}

/**
 * Determine if a directory is empty.
 */
export function isDirEmpty(dirname: string): boolean {
  try {
    return fs.readdirSync(dirname).length === 0
    // Fails in case if directory doesn't exist
  } catch {
    return true
  }
}

/**
 * Returns command success message with execution time.
 */
export function getCommandFailMessage(command: Command, ctx: any): string {
  let message = `Command ${command.id} failed. Error log: ${command.config.errlog}`
  if (ctx.directory && isDirEmpty(ctx.directory)) {
    message += ` Eclipse Che logs: ${ctx.directory}`
  }

  return message
}
