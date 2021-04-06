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
import * as semver from 'semver'

import { CHECTL_PROJECT_NAME } from '../constants'
import { CheTasks } from '../tasks/che'
import { getClusterClientCommand, getProjectName, getProjectVersion } from '../util'

import { ChectlContext } from './context'
import { KubeHelper } from './kube'

export const CHECTL_DEVELOPMENT_VERSION = '0.0.2'

const UPDATE_INFO_FILENAME = 'update-info.json'
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
      task: async (_ctx: any, task: any) => {
        const actualVersion = await getOpenShiftVersion()
        const kube = new KubeHelper(flags)
        if (actualVersion) {
          task.title = `${task.title}: ${actualVersion}.`
        } else if (await kube.isOpenShift4()) {
          task.title = `${task.title}: 4.x`
        } else {
          task.title = `${task.title}: Unknown`
        }

        if (!flags['skip-version-check'] && actualVersion) {
          const checkPassed = checkMinimalVersion(actualVersion, MINIMAL_OPENSHIFT_VERSION)
          if (!checkPassed) {
            throw getMinimalVersionError(actualVersion, MINIMAL_OPENSHIFT_VERSION, 'OpenShift')
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
            throw getMinimalVersionError(actualVersion, MINIMAL_K8S_VERSION, 'Kubernetes')
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

  export function getMinimalVersionError(actualVersion: string, minimalVersion: string, component: string): Error {
    return new Error(`The minimal supported version of ${component} is '${minimalVersion} but '${actualVersion}' was found. To bypass version check use '--skip-version-check' flag.`)
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
    if (getProjectName() !== CHECTL_PROJECT_NAME) {
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

    if (getProjectName() !== CHECTL_PROJECT_NAME) {
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
      try {
        newVersionInfo = (await fs.readJson(newVersionInfoFilePath, { encoding: 'utf8' })) as NewVersionInfoData
      } catch {
        // file is corrupted
      }
    }

    // Check cache, if it is already known that newer version available
    const isCachedNewerVersionAvailable = semver.gt(newVersionInfo.latestVersion, currentVersion)
    const now = Date.now()
    const isCacheExpired = now - newVersionInfo.lastCheck > A_DAY_IN_MS
    if (forceRecheck || (!isCachedNewerVersionAvailable && isCacheExpired)) {
      // Cached info is expired. Fetch actual info about versions.
      // undefined cannot be returned from getLatestChectlVersion as 'is flavor' check was done before.
      const latestVersion = (await getLatestChectlVersion(channel))
      // if request failed (GitHub endpoint is not available) then
      // assume update is not available
      if (!latestVersion) {
        return false
      }
      newVersionInfo = { latestVersion, lastCheck: now }
      await fs.writeJson(newVersionInfoFilePath, newVersionInfo, { encoding: 'utf8' })
      return semver.gt(newVersionInfo.latestVersion, currentVersion)
    }

    // Information whether a newer version available is already in cache
    return isCachedNewerVersionAvailable
  }

  /**
   * Indicates if stable version of Eclipse Che is specified or meant implicitly.
   */
  export function isDeployingStableVersion(flags: any): boolean {
    return !!flags.version || !ChectlContext.get().isNightly
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

}
