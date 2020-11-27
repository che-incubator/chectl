/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'

import { ChectlContext } from './api/context'
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
export function getCommandSuccessMessage(): string {
  const ctx = ChectlContext.get()

  if (ctx[ChectlContext.START_TIME]) {
    if (!ctx[ChectlContext.END_TIME]) {
      ctx[ChectlContext.END_TIME] = Date.now()
    }

    const workingTimeInSeconds = Math.round((ctx[ChectlContext.END_TIME] - ctx[ChectlContext.START_TIME]) / 1000)
    const minutes = Math.floor(workingTimeInSeconds / 60)
    const seconds = (workingTimeInSeconds - minutes * 60) % 60
    const minutesToStr = minutes.toLocaleString([], { minimumIntegerDigits: 2 })
    const secondsToStr = seconds.toLocaleString([], { minimumIntegerDigits: 2 })
    return `Command ${ctx[ChectlContext.COMMAND_ID]} has completed successfully in ${minutesToStr}:${secondsToStr}.`
  }

  return `Command ${ctx[ChectlContext.COMMAND_ID]} has completed successfully.`
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
export function getCommandErrorMessage(err: Error): string {
  const ctx = ChectlContext.get()
  const logDirectory = ctx[ChectlContext.LOGS_DIRECTORY]

  let message = `${err}\nCommand ${ctx[ChectlContext.COMMAND_ID]} failed. Error log: ${ctx[ChectlContext.ERROR_LOG]}`
  if (logDirectory && isDirEmpty(logDirectory)) {
    message += ` Eclipse Che logs: ${logDirectory}`
  }

  return message
}
