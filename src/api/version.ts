/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import execa = require('execa')
import Listr = require('listr')

import { CheTasks } from '../tasks/che'
import { getClusterClientCommand } from '../util'

import { KubeHelper } from './kube'

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

  function removeVPrefix(version: string): string {
    return version.startsWith('v') ? version.substring(1) : version
  }
}
