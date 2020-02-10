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
import execa = require('execa')
import Listr = require('listr')

// tslint:disable-next-line: no-unnecessary-class
export class VersionHelper {
  static MINIMAL_OPENSHIFT_VERSION = '3.11'
  static MINIMAL_K8S_VERSION = '1.9'
  static MINIMAL_HELM_VERSION = '2.15'

  static getOpenShiftCheckVersionTask(flags: any): Listr.ListrTask {
    return {
      title: 'Check OpenShift version',
      task: async (_ctx: any, task: any) => {
        const actualVersion = await VersionHelper.getOpenShiftVersion()
        if (actualVersion) {
          task.title = `${task.title}: Found ${actualVersion}.`
        } else {
          task.title = `${task.title}: Unknown.`
        }

        if (!flags['skip-version-check'] && actualVersion) {
          const checkPassed = VersionHelper.checkMinimalVersions(actualVersion, VersionHelper.MINIMAL_OPENSHIFT_VERSION)
          if (!checkPassed) {
            throw VersionHelper.getError('OpenShift', actualVersion, VersionHelper.MINIMAL_OPENSHIFT_VERSION)
          }
        }
      }
    }
  }

  static getK8sCheckVersionTask(flags: any): Listr.ListrTask {
    return {
      title: 'Check Kubernetes version',
      task: async (_ctx: any, task: any) => {
        const actualVersion = await VersionHelper.getK8sVersion()
        if (actualVersion) {
          task.title = `${task.title}: Found ${actualVersion}.`
        } else {
          task.title = `${task.title}: Unknown.`
        }

        if (!flags['skip-version-check'] && actualVersion) {
          const checkPassed = VersionHelper.checkMinimalVersions(actualVersion, VersionHelper.MINIMAL_K8S_VERSION)
          if (!checkPassed) {
            throw VersionHelper.getError('Kubernetes', actualVersion, VersionHelper.MINIMAL_K8S_VERSION)
          }
        }
      }
    }
  }

  static async getOpenShiftVersion(): Promise<string | undefined> {
    return this.getVersionWithOC('openshift ')
  }

  static async getK8sVersion(): Promise<string | undefined> {
    if (commandExists.sync('oc')) {
      return this.getK8sVersionWithOC()
    } else if (commandExists.sync('kubectl')) {
      return this.getK8sVersionWithKubectl()
    }
  }

  static async getK8sVersionWithOC(): Promise<string | undefined> {
    return this.getVersionWithOC('kubernetes ')
  }

  static async getK8sVersionWithKubectl(): Promise<string | undefined> {
    return this.getVersionWithKubectl('Server Version: ')
  }

  static checkMinimalK8sVersions(actualVersion: string): boolean {
    return this.checkMinimalVersions(actualVersion, this.MINIMAL_K8S_VERSION)
  }

  static checkMinimalOpenShiftVersions(actualVersion: string): boolean {
    return this.checkMinimalVersions(actualVersion, this.MINIMAL_OPENSHIFT_VERSION)
  }

  static checkMinimalHelmVersions(actualVersion: string): boolean {
    return this.checkMinimalVersions(actualVersion, this.MINIMAL_HELM_VERSION)
  }

  /**
   * Compare versions and return true if actual version is greater or equal to minimal.
   * The comparison will be done by major and minor versions.
   */
  static checkMinimalVersions(actual: string, minimal: string): boolean {
    actual = this.removeVPrefix(actual)
    let vers = actual.split('.')
    const actualMajor = parseInt(vers[0], 10)
    const actualMinor = parseInt(vers[1], 10)

    minimal = this.removeVPrefix(minimal)
    vers = actual.split('.')
    const minimalMajor = parseInt(vers[0], 10)
    const minimalMinor = parseInt(vers[1], 10)

    return (actualMajor >= minimalMajor || (actualMajor === minimalMajor && actualMinor >= minimalMinor))
  }

  static getError(actualVersion: string, minimalVersion: string, component: string): Error {
    return new Error(`The minimal supported version of ${component} is '${minimalVersion} but found '${actualVersion}'. To bypass version check use '--skip-version-check' flag.`)
  }

  private static async getVersionWithOC(versionPrefix: string): Promise<string | undefined> {
    const command = 'oc'
    const args = ['version']
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.split('\n').filter(value => value.startsWith(versionPrefix)).map(value => value.substring(versionPrefix.length))[0]
  }

  private static async getVersionWithKubectl(versionPrefix: string): Promise<string | undefined> {
    const command = 'kubectl'
    const args = ['version', '--short']
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.split('\n').filter(value => value.startsWith(versionPrefix)).map(value => value.substring(versionPrefix.length))[0]
  }

  private static removeVPrefix(version: string): string {
    return version.startsWith('v') ? version.substring(1) : version
  }
}
