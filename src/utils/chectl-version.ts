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

import axios from 'axios'
import { ux } from '@oclif/core'
import * as fs from 'fs-extra'
import * as https from 'node:https'
import * as path from 'node:path'
import * as semver from 'semver'
import { CHECTL_REPO, CheGithubClient, ECLIPSE_CHE_INCUBATOR_ORG } from '../api/github-client'
import { getProjectVersion } from './utls'
import { CheCtlContext, CliContext } from '../context'

export const CHECTL_DEVELOPMENT_VERSION = '0.0.2'

const UPDATE_INFO_FILENAME = 'update-info.json'
interface NewVersionInfoData {
  latestVersion: string
  // datetime of last check in milliseconds
  lastCheck: number
}
const A_DAY_IN_MS = 24 * 60 * 60 * 1000

export namespace CheCtlVersion {

  /**
   * Returns latest chectl version for the given channel.
   */
  export async function getLatestCheCtlVersion(channel: string): Promise<string | undefined> {
    if (!CheCtlContext.get()[CliContext.CLI_IS_CHECTL]) {
      return
    }

    const axiosInstance = axios.create({
      httpsAgent: new https.Agent({}),
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
  export async function isCheCtlUpdateAvailable(cacheDir: string, forceRecheck = false): Promise<boolean> {
    // Do not use ctx inside this function as the function is used from hook where ctx is not yet defined.

    if (!CheCtlContext.get()[CliContext.CLI_IS_CHECTL]) {
      // Do nothing for not chectl flavors
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
    let isCachedNewerVersionAvailable = false
    try {
      isCachedNewerVersionAvailable = await gtCheCtlVersion(newVersionInfo.latestVersion, currentVersion)
    } catch (error) {
      // not a version (corrupted data)
      ux.debug(`Failed to compare versions '${newVersionInfo.latestVersion}' and '${currentVersion}': ${error}`)
    }

    const now = Date.now()
    const isCacheExpired = now - newVersionInfo.lastCheck > A_DAY_IN_MS
    if (forceRecheck || (!isCachedNewerVersionAvailable && isCacheExpired)) {
      // Cached info is expired. Fetch actual info about versions.
      // undefined cannot be returned from getLatestChectlVersion as 'is flavor' check was done before.
      const latestVersion = (await getLatestCheCtlVersion(channel))
      // if request failed (GitHub endpoint is not available) then
      // assume update is not available
      if (!latestVersion) {
        return false
      }

      newVersionInfo = { latestVersion, lastCheck: now }
      await fs.writeJson(newVersionInfoFilePath, newVersionInfo, { encoding: 'utf8' })
      try {
        return gtCheCtlVersion(newVersionInfo.latestVersion, currentVersion)
      } catch (error) {
        // not to fail unexpectedly
        ux.debug(`Failed to compare versions '${newVersionInfo.latestVersion}' and '${currentVersion}': ${error}`)
        return false
      }
    }

    // Information whether a newer version available is already in cache
    return isCachedNewerVersionAvailable
  }

  /**
   * Returns true if verA > verB
   */
  export async function gtCheCtlVersion(verA: string, verB: string): Promise<boolean> {
    return (await compareCheCtlVersions(verA, verB)) > 0
  }

  /**
   * Retruns:
   *  1 if verA > verB
   *  0 if verA = verB
   * -1 if verA < verB
   */
  async function compareCheCtlVersions(verA: string, verB: string): Promise<number> {
    if (verA === verB) {
      return 0
    }

    const verAChannel = verA.includes('next') ? 'next' : 'stable'
    const verBChannel = verB.includes('next') ? 'next' : 'stable'
    if (verAChannel !== verBChannel) {
      // Consider next is always newer
      return (verAChannel === 'next') ? 1 : -1
    }

    if (verAChannel === 'stable') {
      return semver.gt(verA, verB) ? 1 : -1
    }

    // Compare next versions, like: 0.0.20210715-next.597729a
    const verABase = verA.split('-')[0]
    const verBBase = verB.split('-')[0]
    if (verABase !== verBBase) {
      // Releases are made in different days
      // It is possible to compare just versions
      return semver.gt(verA, verB) ? 1 : -1
    }

    // Releases are made in the same day
    // It is not possible to compare by versions as the difference only in commits hashes
    const verACommitId = verA.split('-')[1].split('.')[1]
    const verBCommitId = verB.split('-')[1].split('.')[1]

    const githubClient = new CheGithubClient()
    const verACommitDateString = await githubClient.getCommitDate(ECLIPSE_CHE_INCUBATOR_ORG, CHECTL_REPO, verACommitId)
    const verBCommitDateString = await githubClient.getCommitDate(ECLIPSE_CHE_INCUBATOR_ORG, CHECTL_REPO, verBCommitId)
    const verATimestamp = Date.parse(verACommitDateString)
    const verBTimestamp = Date.parse(verBCommitDateString)
    return verATimestamp > verBTimestamp ? 1 : -1
  }
}
