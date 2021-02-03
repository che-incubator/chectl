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
import execa = require('execa')
import * as fs from 'fs-extra'
import * as https from 'https'
import Listr = require('listr')
import * as path from 'path'

import { CheTasks } from '../tasks/che'
import { getClusterClientCommand, getProjectName, getProjectVersion } from '../util'

import { KubeHelper } from './kube'

export const CHECTL_DEVELOPMENT_VERSION = '0.0.2'

const UPDATE_INFO_FILENAME = 'new-version-info.json'
interface NewVersionInfoData {
  latestVersion: string
  // datetime of last check in milliseconds
  lastCheck: number
}
const A_DAY_IN_MS = 24 * 60 * 60 * 1000

export namespace VersionHelper {
  export const MINIMAL_OPENSHIFT_VERSION = '3.11'
  export const MINIMAL_K8S_VERSION = '1.9'
  export const MINIMAL_HELM_VERSION = '2.15'
  export const CHE_POD_MANIFEST_FILE = '/home/user/eclipse-che/tomcat/webapps/ROOT/META-INF/MANIFEST.MF'
  export const CHE_PREFFIX_VERSION = 'Implementation-Version: '

  export function getOpenShiftCheckVersionTask(flags: any): Listr.ListrTask {
    return {
      title: 'Check OpenShift version',
      task: async (ctx: any, task: any) => {
        const actualVersion = await getOpenShiftVersion()
        if (actualVersion) {
          task.title = `${task.title}: ${actualVersion}.`
        } else if (ctx.isOpenShift4) {
          task.title = `${task.title}: 4.x`
        } else {
          task.title = `${task.title}: Unknown`
        }

        if (!flags['skip-version-check'] && actualVersion) {
          const checkPassed = checkMinimalVersion(actualVersion, MINIMAL_OPENSHIFT_VERSION)
          if (!checkPassed) {
            throw getError('OpenShift', actualVersion, MINIMAL_OPENSHIFT_VERSION)
          }
        }
      }
    }
  }
  export function getK8sCheckVersionTask(flags: any): Listr.ListrTask {
    return {
      title: 'Check Kubernetes version',
      task: async (_ctx: any, task: any) => {
        let actualVersion
        switch (flags.platform) {
        case 'minishift':
        case 'openshift':
        case 'crc':
          actualVersion = await getK8sVersionWithOC()
          break
        default:
          actualVersion = await getK8sVersionWithKubectl()
        }

        if (actualVersion) {
          task.title = `${task.title}: Found ${actualVersion}.`
        } else {
          task.title = `${task.title}: Unknown.`
        }

        if (!flags['skip-version-check'] && actualVersion) {
          const checkPassed = checkMinimalVersion(actualVersion, MINIMAL_K8S_VERSION)
          if (!checkPassed) {
            throw getError('Kubernetes', actualVersion, MINIMAL_K8S_VERSION)
          }
        }
      }
    }
  }

  export async function getOpenShiftVersion(): Promise<string | undefined> {
    return getVersionWithOC('openshift ')
  }

  export async function getK8sVersionWithOC(): Promise<string | undefined> {
    return getVersionWithOC('kubernetes ')
  }

  export async function getK8sVersionWithKubectl(): Promise<string | undefined> {
    return getVersionWithKubectl('Server Version: ')
  }

  export function checkMinimalK8sVersion(actualVersion: string): boolean {
    return checkMinimalVersion(actualVersion, MINIMAL_K8S_VERSION)
  }

  export function checkMinimalOpenShiftVersion(actualVersion: string): boolean {
    return checkMinimalVersion(actualVersion, MINIMAL_OPENSHIFT_VERSION)
  }

  export function checkMinimalHelmVersion(actualVersion: string): boolean {
    return checkMinimalVersion(actualVersion, MINIMAL_HELM_VERSION)
  }

  /**
   * Compare versions and return true if actual version is greater or equal to minimal.
   * The comparison will be done by major and minor versions.
   */
  export function checkMinimalVersion(actual: string, minimal: string): boolean {
    actual = removeVPrefix(actual)
    let vers = actual.split('.')
    const actualMajor = parseInt(vers[0], 10)
    const actualMinor = parseInt(vers[1], 10)

    minimal = removeVPrefix(minimal)
    vers = minimal.split('.')
    const minimalMajor = parseInt(vers[0], 10)
    const minimalMinor = parseInt(vers[1], 10)

    return (actualMajor > minimalMajor || (actualMajor === minimalMajor && actualMinor >= minimalMinor))
  }

  export function getError(actualVersion: string, minimalVersion: string, component: string): Error {
    return new Error(`The minimal supported version of ${component} is '${minimalVersion} but found '${actualVersion}'. To bypass version check use '--skip-version-check' flag.`)
  }

  async function getVersionWithOC(versionPrefix: string): Promise<string | undefined> {
    const command = 'oc'
    const args = ['version']
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.split('\n').filter(value => value.startsWith(versionPrefix)).map(value => value.substring(versionPrefix.length))[0]
  }

  async function getVersionWithKubectl(versionPrefix: string): Promise<string | undefined> {
    const command = 'kubectl'
    const args = ['version', '--short']
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.split('\n').filter(value => value.startsWith(versionPrefix)).map(value => value.substring(versionPrefix.length))[0]
  }

  /**
   * Returns Eclipse Che version.
   */
  export async function getCheVersion(flags: any): Promise<string> {
    const kube = new KubeHelper(flags)
    const cheTasks = new CheTasks(flags)
    const cheCluster = await kube.getCheCluster(flags.chenamespace)
    if (cheCluster && cheCluster.spec.server.cheFlavor !== 'che') {
      return cheCluster.status.cheVersion
    }

    const chePodList = await kube.getPodListByLabel(flags.chenamespace, cheTasks.cheSelector)
    const [chePodName] = chePodList.map(pod => pod.metadata && pod.metadata.name)
    if (!chePodName) {
      return 'UNKNOWN'
    }

    const command = getClusterClientCommand()
    const args = ['exec', chePodName, '--namespace', flags.chenamespace, 'cat', CHE_POD_MANIFEST_FILE]
    try {
      const { stdout } = await execa(command, args, { timeout: 60000 })
      return stdout.split('\n').filter(value => value.startsWith(CHE_PREFFIX_VERSION)).map(value => value.substring(CHE_PREFFIX_VERSION.length))[0]
    } catch {
      return 'UNKNOWN'
    }
  }

  /**
   * Returns latest chectl version for the given channel.
   */
  export async function getLatestChectlVersion(channel: string): Promise<string | undefined> {
    if (getProjectName() !== 'chectl') {
      return
    }

    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({})
    })

    try {
      const { data } = await axiosInstance.get(`https://che-incubator.github.io/chectl/channels/${channel}/linux-x64`)
      return data.version
    } catch {
      return
    }
  }

  /**
   * Checks whether there is an update available for current chectl.
   */
  export async function isChectlUpdateAvailable(cacheDir: string, forceRecheck = false): Promise<boolean> {
    // Do not use ctx inside this function as the function is used from hook where ctx is not yet defined.

    if (getProjectName() !== 'chectl') {
      // Do nothing for chectl flavors
      return false
    }

    const currentVersion = getProjectVersion()
    if (currentVersion === CHECTL_DEVELOPMENT_VERSION) {
      // Skip it, chectl is built from source
      return false
    }

    const channel = currentVersion.includes('next') ? 'next' : 'stable'
    const newVersionInfoFilePath = path.join(cacheDir, `${channel}-${UPDATE_INFO_FILENAME}`)
    let newVersionInfo: NewVersionInfoData = {
      latestVersion: '0.0.0',
      lastCheck: 0,
    }
    if (await fs.pathExists(newVersionInfoFilePath)) {
      newVersionInfo = (await fs.readJson(newVersionInfoFilePath, { encoding: 'utf8' })) as NewVersionInfoData
    }

    // Check cache, if it is already known that newer version available
    const isCachedNewerVersionAvailable = compareVersions(newVersionInfo.latestVersion, currentVersion) > 0
    const now = Date.now()
    const isCacheExpired = now - newVersionInfo.lastCheck > A_DAY_IN_MS
    if (forceRecheck || (!isCachedNewerVersionAvailable && isCacheExpired)) {
      // Cached info is expired. Fetch actual info about versions.
      // undefined cannot be returned from getLatestChectlVersion as 'is flavor' check was done before.
      const latestVersion = (await getLatestChectlVersion(channel))!
      newVersionInfo = { latestVersion, lastCheck: now }
      await fs.writeJson(newVersionInfoFilePath, newVersionInfo, { encoding: 'utf8' })
      return compareVersions(newVersionInfo.latestVersion, currentVersion) > 0
    }

    // Information whether a newer version available is already in cache
    return isCachedNewerVersionAvailable
  }

  /**
   * Indicates if stable version of Eclispe Che is specified.
   */
  export function isStableVersion(flags: any): boolean {
    return flags.version !== 'next' && flags.version !== 'nightly'
  }

  /**
   * Indicates if the newest stable or nightly version is specified by its alias.
   */
  export function isTopVersion(flags: any): boolean {
    return !flags.version || flags.version === 'next' || flags.version === 'nightly' || flags.version === 'latest' || flags.version === 'stable'
  }

  /**
   * Removes 'v' prefix from version string.
   * @param version version to process
   * @param checkForNumber if true remove prefix only if a numeric version follow it (e.g. v7.x -> 7.x, vNext -> vNext)
   */
  export function removeVPrefix(version: string, checkForNumber = false): string {
    if (version.startsWith('v') && version.length > 1) {
      if (checkForNumber) {
        const char2 = version.charAt(1)
        if (char2 >= '0' && char2 <= '9') {
          return version.substr(1)
        }
      }
      return version.substr(1)
    }
    return version
  }

  /**
   * Compares versions in format: x.y.z.w...
   * Prefix 'v' is automatically deleted if in preceeds numeric version (e.g. v7.15.2 or v7.x).
   * The following rules applies to the comparison:
   * - if one of the arguments is a text it will be greater (e.g. 7.15 is less than latest)
   * - if both arguments are text, then string comparison is applied (e.g. nightly greater than next)
   * - if a part of a version has suffix, but another don't have it, version with suffix will be lesser (e.g. 7.15 is greater than 7.15-RC2)
   * - if both version have suffixes, they are compared as strings (e.g. 7.15-RZ is greater than 7.15-RA)
   * - if an argument has more version parts and first n are equal, then longer is lesser (e.g. 7.15 is greater than 7.15.1)
   * | Arguments | Returns |
   * | --------  | ------- |
   *    a > b    |    1
   *    a = b    |    0
   *    a < b    |   -1
   */
  export function compareVersions(a: string, b: string): number {
    a = removeVPrefix(a, true)
    b = removeVPrefix(b, true)

    const aParts = a.split('.')
    const bParts = b.split('.')
    const length = aParts.length > bParts.length ? bParts.length : aParts.length
    for (let i = 0; i < length; i++) {
      if (aParts[i] !== bParts[i]) {
        const ai = parseInt(aParts[i], 10)
        const bi = parseInt(bParts[i], 10)

        if (isNaN(ai) || isNaN(bi)) {
          // At least one part starts with a letter
          return aParts[i] > bParts[i] ? 1 : -1
        } else {
          if (ai !== bi) {
            return ai > bi ? 1 : -1
          } else {
            // Numeric prefixes are equal
            // If a version doesn't have a suffix, then consider it greater (e.g. 7.15 is greater than 7.15-RC2)
            // Otherwise compare suffixes as strings (e.g. 7.1-RC1 with 7.1-RC2)
            if (aParts[i].startsWith(bParts[i])) {
              return -1
            } else if (bParts[i].startsWith(aParts[i])) {
              return 1
            } else {
              // Compare suffixes as strings
              return aParts[i] > bParts[i] ? 1 : -1
            }
          }
        }
      }
    }
    // One version string includes the other, so longer is lesser (e.g. 7.20.2 is lesser than 7.20)
    return bParts.length - aParts.length
  }

}
