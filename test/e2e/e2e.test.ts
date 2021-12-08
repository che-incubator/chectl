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

// tslint:disable: no-console

import { expect } from '@oclif/test'
import * as execa from 'execa'
import { DEFAULT_OLM_SUGGESTED_NAMESPACE } from '../../src/constants'
import { E2eHelper } from './util'

const helper = new E2eHelper()
jest.setTimeout(1000000)

const binChectl = E2eHelper.getChectlBinaries()

const NAMESPACE = DEFAULT_OLM_SUGGESTED_NAMESPACE

const PLATFORM = process.env.PLATFORM || ''
const INSTALLER = process.env.INSTALLER || ''

const PLATFORM_OPENSHIFT = 'openshift'
const PLATFORM_CRC = 'crc'
const PLATFORM_MINISHIFT = 'minishift'
const PLATFORM_MINIKUBE = 'minikube'

const INSTALLER_OPERATOR = 'operator'
const INSTALLER_OLM = 'olm'

function getDeployCommand(): string {
  const cheVersion = helper.getNewVersion()

  let command: string
  switch (PLATFORM) {
    case PLATFORM_OPENSHIFT:
      if (!(INSTALLER === INSTALLER_OPERATOR || INSTALLER === INSTALLER_OLM)) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      command = `${binChectl} server:deploy --batch --platform=${PLATFORM} --installer=${INSTALLER} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      break

    case PLATFORM_CRC:
    case PLATFORM_MINISHIFT:
      if (INSTALLER !== INSTALLER_OPERATOR) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      command = `${binChectl} server:deploy --batch --platform=${PLATFORM} --installer=${INSTALLER} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      break

    case PLATFORM_MINIKUBE:
      if (INSTALLER !== INSTALLER_OPERATOR) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      const patchOption = '--che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml'
      command = `${binChectl} server:deploy --batch --platform=${PLATFORM} --installer=${INSTALLER} --telemetry=off --chenamespace=${NAMESPACE} ${patchOption} --multiuser --skip-cluster-availability-check`
      break

    default:
      throw new Error(`Unknown platform: ${PLATFORM}`)
  }
  if (cheVersion != 'next') {
    command = command + ` --version=${cheVersion}`
  }
  command = command + ` --workspace-engine=dev-workspace`

  return command
}

describe(`server:deploy using ${INSTALLER} installer`, () => {
  it(`server:deploy using ${INSTALLER} installer command`, async () => {
    const command = getDeployCommand()
    console.log(command)
    const { exitCode, stdout, stderr } = await execa(command, { shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }

    // sleep after deploying
    await execa('sleep 15s', { shell: true })
  })
})

describe('Export CA certificate', () => {
  it('cacert:export command', async () => {
    const command = `${binChectl} cacert:export -n ${NAMESPACE} --telemetry=off`

    const { exitCode, stdout, stderr } = await execa(command, { shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })
})

describe('Get Eclipse Che server status', () => {
  it('server:status command', async () => {
    const { exitCode, stdout, stderr } = await execa(binChectl, ['server:status', `--chenamespace ${NAMESPACE}`, '--telemetry=off'], { shell: true })

    console.log(`stdout: ${stdout}`)
    console.log(`stderr: ${stderr}`)
    expect(exitCode).equal(0)
  })
})

describe('Stop Eclipse Che server', () => {
  it('server:stop command', async () => {
    const { exitCode, stdout, stderr } = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

    console.log(`stdout: ${stdout}`)
    console.log(`stderr: ${stderr}`)
    expect(exitCode).equal(0)
  })
})

describe('Delete Eclipse Che server', () => {
  it('server:delete command', async () => {
    let result = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

    console.log(`stdout: ${result.stdout}`)
    console.log(`stderr: ${result.stderr}`)
    expect(result.exitCode).equal(0)

    // run deletion second time to ensure that
    // server:delete does not fail if resource is absent
    result = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

    console.log(`stdout: ${result.stdout}`)
    console.log(`stderr: ${result.stderr}`)
    expect(result.exitCode).equal(0)
  })
})
