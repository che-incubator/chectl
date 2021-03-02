/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

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
import { promisify } from 'util'

import { ChectlContext } from './api/context'
import { KubeHelper } from './api/kube'
import { VersionHelper } from './api/version'
import { DEFAULT_CHE_NAMESPACE, LEGACY_CHE_NAMESPACE } from './constants'

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
 * Returns command error message.
 */
export function getCommandErrorMessage(err: Error): string {
  const ctx = ChectlContext.get()
  const logDirectory = ctx[ChectlContext.LOGS_DIR]

  let message = `${err}\nCommand ${ctx[ChectlContext.COMMAND_ID]} failed. Error log: ${ctx[ChectlContext.ERROR_LOG]}`
  if (logDirectory && isDirEmpty(logDirectory)) {
    message += ` Eclipse Che logs: ${logDirectory}`
  }

  return message
}

export function notifyCommandCompletedSuccessfully(): void {
  notifier.notify({
    title: 'chectl',
    message: getCommandSuccessMessage()
  })
}

export async function askForChectlUpdateIfNeeded(): Promise<void> {
  const ctx = ChectlContext.get()
  if (await VersionHelper.isChectlUpdateAvailable(ctx[ChectlContext.CACHE_DIR])) {
    cli.info('A newer version of chectl is available.')
    if (await cli.confirm('To deploy the latest version of Eclipse Che you have to update chectl first [y/n]')) {
      cli.info('Please run "chectl update" and then repeat "server:deploy" command.')
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
  return yaml.safeLoad(fs.readFileSync(filePath).toString())
}

export function safeSaveYamlToFile(yamlObject: any, filePath: string): void {
  fs.writeFileSync(filePath, yaml.safeDump(yamlObject))
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
    httpsAgent: new https.Agent({})
  })
  const response = await axiosInstance.get(url)
  return yaml.safeLoad(response.data)
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

/**
 * The default Eclipse Che namespace has been changed from 'che' to 'eclipse-che'.
 * It checks if legacy namespace 'che' exists. If so all chectl commands
 * will launched against that namespace otherwise default 'eclipse-che' namespace will be used.
 */
export async function findWorkingNamespace(flags: any): Promise<string> {
  if (flags.chenamespace) {
    // use user specified namespace
    return flags.chenamespace
  }

  const kubeHelper = new KubeHelper(flags)

  if (await kubeHelper.getNamespace(DEFAULT_CHE_NAMESPACE)) {
    return DEFAULT_CHE_NAMESPACE
  }

  if (await kubeHelper.getNamespace(LEGACY_CHE_NAMESPACE)) {
    return LEGACY_CHE_NAMESPACE
  }

  return DEFAULT_CHE_NAMESPACE
}

export async function getDistribution(): Promise<string | undefined> {
  if (os.platform() === 'linux') {
    const platorm = await promisify(getos)() as getos.LinuxOs
    return platorm.dist
  }
  return
}
