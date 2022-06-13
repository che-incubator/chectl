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

import UpdateCommand from '@oclif/plugin-update/lib/commands/update'
import axios from 'axios'
import { cli } from 'cli-ux'
import * as commandExists from 'command-exists'
import * as fs from 'fs-extra'
import * as getos from 'getos'
import * as https from 'https'
import * as yaml from 'js-yaml'
import * as notifier from 'node-notifier'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { promisify } from 'util'
import { ChectlContext } from './api/context'
import { KubeHelper } from './api/kube'
import { VersionHelper } from './api/version'
import {
  CHE_CLUSTER_API_GROUP,
  CHE_CLUSTER_API_VERSION_V1,
  CHE_CLUSTER_API_VERSION_V2,
  CHE_TLS_SECRET_NAME,
} from './constants'

const pkjson = require('../package.json')

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
  return platform === 'k8s' || platform === 'minikube' || platform === 'microk8s' || platform === 'docker-desktop'
}

export function isOpenshiftPlatformFamily(platform: string): boolean {
  return platform === 'openshift' || platform === 'crc'
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
    for (const range of ranges) {
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

export function base64Encode(arg: string): string {
  return Buffer.from(arg).toString('base64')
}

/**
 * Separates docker image repository and tag.
 * @param image string with image and tag separated by a colon
 * @returns image name (including registry and account) and image tag correspondingly
 */
export function getImageNameAndTag(image: string): [string, string] {
  let deployedCheOperatorImageName: string
  let deployedCheOperatorImageTag: string

  if (image.includes('@')) {
    // Image is referenced via a digest
    const index = image.indexOf('@')
    deployedCheOperatorImageName = image.substring(0, index)
    deployedCheOperatorImageTag = image.substring(index + 1)
  } else {
    // Image is referenced via a tag
    const lastColonIndex = image.lastIndexOf(':')
    if (lastColonIndex === -1) {
      // Image name without a tag
      deployedCheOperatorImageName = image
      deployedCheOperatorImageTag = 'latest'
    } else {
      const beforeLastColon = image.substring(0, lastColonIndex)
      const afterLastColon = image.substring(lastColonIndex + 1)
      if (afterLastColon.includes('/')) {
        // The colon is for registry port and not for a tag
        deployedCheOperatorImageName = image
        deployedCheOperatorImageTag = 'latest'
      } else {
        // The colon separates image name from the tag
        deployedCheOperatorImageName = beforeLastColon
        deployedCheOperatorImageTag = afterLastColon
      }
    }
  }
  return [deployedCheOperatorImageName, deployedCheOperatorImageTag]
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
    return safeLoadFromYamlFile(CRFilePath)
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
 * Wraps error into command error.
 */
export function wrapCommandError(error: Error): Error {
  const ctx = ChectlContext.get()
  const logDirectory = ctx[ChectlContext.LOGS_DIR]

  let commandErrorMessage = `Command ${ctx[ChectlContext.COMMAND_ID]} failed. Error log: ${ctx[ChectlContext.ERROR_LOG]}.`
  if (logDirectory && isDirEmpty(logDirectory)) {
    commandErrorMessage += ` Eclipse Che logs: ${logDirectory}.`
  }

  return newError(commandErrorMessage, error)
}

export function newError(message: string, cause: Error): Error {
  const error = new Error(message)
  error.stack += `\nCause: ${cause.stack}`
  return error
}

export function notifyCommandCompletedSuccessfully(): void {
  notifier.notify({
    title: 'chectl',
    message: getCommandSuccessMessage(),
  })
}

export async function askForChectlUpdateIfNeeded(): Promise<void> {
  const ctx = ChectlContext.get()
  if (await VersionHelper.isChectlUpdateAvailable(ctx[ChectlContext.CACHE_DIR])) {
    cli.info('A more recent version of chectl is available. To deploy the latest version of Eclipse Che, update the chectl tool first.')
    if (await cli.confirm('Do you want to update chectl now? [y/n]')) {
      // Update chectl
      await UpdateCommand.run([])
      cli.exit(0)
    }
  }
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
 * Returns current chectl version defined in package.json.
 */
export function getProjectVersion(): string {
  return pkjson.version
}

/**
 * Returns current chectl version defined in package.json.
 */
export function getProjectName(): string {
  return pkjson.name
}

export function readPackageJson(): any {
  return JSON.parse(fs.readFileSync('../package.json').toString())
}

export function safeLoadFromYamlFile(filePath: string): any {
  return yaml.load(fs.readFileSync(filePath).toString())
}

export function safeSaveYamlToFile(yamlObject: any, filePath: string): void {
  fs.writeFileSync(filePath, yaml.dump(yamlObject))
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const streamWriter = fs.createWriteStream(dest)
  const response = await axios({ url, method: 'GET', responseType: 'stream' })
  response.data.pipe(streamWriter)
  return new Promise((resolve, reject) => {
    streamWriter.on('finish', resolve)
    streamWriter.on('error', reject)
  })
}

/**
 * Downloads yaml file and returns data converted to JSON.
 * @param url link to yaml file
 */
export async function downloadYaml(url: string): Promise<any> {
  const axiosInstance = axios.create({
    httpsAgent: new https.Agent({}),
  })
  const response = await axiosInstance.get(url)
  return yaml.load(response.data)
}

export function getEmbeddedTemplatesDirectory(): string {
  // Embedded templates are located in the templates directory that is in the project/installation root:
  // chectl
  //  |- templates
  //  |- src
  //  |   |- util.ts
  //  |  ...
  //  |- lib
  //  |   |- util.js
  // ... ...
  // __dirname is
  //   project_root/src if dev mode,
  //   installation_root/lib if run from an installed location
  return path.join(__dirname, '..', 'templates')
}

export async function findWorkingNamespace(flags: any): Promise<string | undefined> {
  const kubeHelper = new KubeHelper(flags)
  const checlusters = await kubeHelper.getAllCheClusters()
  if (checlusters.length === 1) {
    return checlusters[0].metadata.namespace
  }
}

/**
 * Return linux distribution if chectl command is executed in linux
 */
export async function getDistribution(): Promise<string | undefined> {
  if (os.platform() === 'linux') {
    try {
      const platorm = await promisify(getos)() as getos.LinuxOs
      return platorm.dist
    } catch {
      return
    }
  }
  return
}

export function addTrailingSlash(url: string): string {
  if (url.endsWith('/')) {
    return url
  }
  return url + '/'
}

/**
 * Waits until y or n is pressed (no return press needed) and returns confirmation result.
 * ctrl+c causes exception.
 * This function doesn't print anything, this is the task of the code that invokes it.
 */
export function confirmYN(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }

    const removeKeyPressHandler = () => {
      process.stdin.removeListener('keypress', keyPressHandler)
      process.stdin.setRawMode(false)
      process.stdin.destroy()
    }
    const keyPressHandler = (_string: any, key: any) => {
      // Handle brake
      if (key.ctrl && key.name === 'c') {
        removeKeyPressHandler()
        reject('Interrupted')
      }

      // Check if y or n pressed
      if (key.name === 'y' || key.name === 'Y') {
        removeKeyPressHandler()
        resolve(true)
      } else if (key.name === 'n' || key.name === 'N') {
        removeKeyPressHandler()
        resolve(false)
      }
    }
    process.stdin.on('keypress', keyPressHandler)
  })
}

export function getTlsSecretName(ctx: any): string  {
  const crPatch = ctx[ChectlContext.CR_PATCH]

  if (crPatch?.spec?.k8s?.tlsSecretName !== undefined) {
    return crPatch?.spec?.k8s?.tlsSecretName
  }

  if (crPatch?.spec?.networking?.tlsSecretName !== undefined) {
    return crPatch?.spec?.networking?.tlsSecretName
  }

  if (ctx.customCR?.spec?.k8s?.tlsSecretName !== undefined) {
    return ctx.customCR?.spec?.k8s?.tlsSecretName
  }

  if (ctx.customCR?.networking?.tlsSecretName !== undefined) {
    return ctx.customCR?.networking?.tlsSecretName
  }

  return CHE_TLS_SECRET_NAME
}

export function getWarnVersionFlagMsg(_flags: any): string {
  return `'--version' flag is not supported anymore.
1. Update chectl to a specific version following the doc https://github.com/che-incubator/chectl#updating
2. Use chectl of the specific version to deploy or to upgrade Eclipse Che`
}

export function isCheClusterAPIV1(checluster: any): boolean {
  return checluster.apiVersion === `${CHE_CLUSTER_API_GROUP}/${CHE_CLUSTER_API_VERSION_V1}`
}

export function isCheClusterAPIV2(checluster: any): boolean {
  return checluster.apiVersion === `${CHE_CLUSTER_API_GROUP}/${CHE_CLUSTER_API_VERSION_V2}`
}

export function isWebhookAvailabilityError(error: any): boolean {
  const msg = error.message as string
  return msg.indexOf('service "che-operator-service" not found') !== -1 ||
    msg.indexOf('no endpoints available for service "che-operator-service"') !== -1 ||
    msg.indexOf('conversion webhook') !== -1
}
