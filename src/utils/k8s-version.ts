/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

export namespace K8sVersion {
  export const MINIMAL_K8S_VERSION = '1.19'

  export function checkMinimalK8sVersion(actualVersion: string): boolean {
    return checkMinimalVersion(actualVersion, MINIMAL_K8S_VERSION)
  }

  /**
   * Compare versions and return true if actual version is greater or equal to minimal.
   * The comparison will be done by major and minor versions.
   */
  export function checkMinimalVersion(actual: string, minimal: string): boolean {
    actual = removeVPrefix(actual)
    let vers = actual.split('.')
    const actualMajor = Number.parseInt(vers[0], 10)
    const actualMinor = Number.parseInt(vers[1], 10)

    minimal = removeVPrefix(minimal)
    vers = minimal.split('.')
    const minimalMajor = Number.parseInt(vers[0], 10)
    const minimalMinor = Number.parseInt(vers[1], 10)

    return (actualMajor > minimalMajor || (actualMajor === minimalMajor && actualMinor >= minimalMinor))
  }

  export function getMinimalK8sVersionError(actualVersion: string): Error {
    return new Error(`The minimal supported version of Kubernetes is '${MINIMAL_K8S_VERSION} but '${actualVersion}' was found. To bypass version check use '--skip-version-check' flag.`)
  }

  /**
   * Removes 'v' prefix from version string.
   * @param version version to process
   * @param checkForNumber if true remove prefix only if a numeric version follow it (e.g. v7.x -> 7.x, vNext -> vNext)
   */
  function removeVPrefix(version: string, checkForNumber = false): string {
    if (version.startsWith('v') && version.length > 1) {
      if (checkForNumber) {
        const char2 = version.charAt(1)
        if (char2 >= '0' && char2 <= '9') {
          return version.slice(1)
        }
      }

      return version.slice(1)
    }

    return version
  }
}
