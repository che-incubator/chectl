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
