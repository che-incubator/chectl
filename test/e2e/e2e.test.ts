/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

// tslint:disable: no-console

import { expect, test } from '@oclif/test'
import * as execa from 'execa'

import { DEFAULT_OLM_SUGGESTED_NAMESPACE } from '../../src/constants'
import { isKubernetesPlatformFamily } from '../../src/util'

import { E2eHelper, LOGS_DIR, WORKSPACE_NAMESPACE } from './util'

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
const INSTALLER_HELM = 'helm'
const INSTALLER_OLM = 'olm'

const DEVFILE_URL = 'https://raw.githubusercontent.com/eclipse/che-devfile-registry/master/devfiles/quarkus/devfile.yaml'

function getDeployCommand(): string {
  let command: string
  switch (PLATFORM) {
    case PLATFORM_OPENSHIFT:
      if (!(INSTALLER === INSTALLER_OPERATOR || INSTALLER === INSTALLER_OLM)) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      command = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      break

    case PLATFORM_CRC:
    case PLATFORM_MINISHIFT:
      if (INSTALLER !== INSTALLER_OPERATOR) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      command = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      break

    case PLATFORM_MINIKUBE:
      if (!(INSTALLER === INSTALLER_OPERATOR || INSTALLER === INSTALLER_HELM || INSTALLER === INSTALLER_OLM)) {
        throw new Error(`Unknown installer ${INSTALLER}`)
      }
      const patchOption = INSTALLER === INSTALLER_HELM ? '--helm-patch-yaml=test/e2e/resources/helm-patch.yaml' : '--che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml'
      command = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --telemetry=off --chenamespace=${NAMESPACE} ${patchOption} --multiuser --skip-cluster-availability-check`
      break

    default:
      throw new Error(`Unknown platform: ${PLATFORM}`)
  }
  return command
}

describe('Eclipse Che deploy deployemnt', () => {
  describe(`server:deploy using ${INSTALLER} installer and self signed certificates`, () => {
    it(`server:deploy using ${INSTALLER} installer and self signed certificates`, async () => {
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
})

describe('Eclipse Che server authentication', () => {
  it('Should login in to Che server with username and password', async () => {
    let cheApiEndpoint: string
    if (isKubernetesPlatformFamily(PLATFORM)) {
      const ingressName = INSTALLER === INSTALLER_HELM ? 'che-ingress' : 'che'
      cheApiEndpoint = await helper.K8SHostname(ingressName, NAMESPACE) + '/api'
    } else {
      cheApiEndpoint = await helper.OCHostname('che', NAMESPACE) + '/api'
    }

    const command = `${binChectl} auth:login`
    const args = [cheApiEndpoint, '-u', 'admin', '-p', 'admin', '-n', `${NAMESPACE}`, '--telemetry', 'off']

    const { exitCode, stdout, stderr } = await execa(command, args, { shell: true })

    expect(exitCode).equal(0)
    expect(stdout).to.contain('Successfully logged into')
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })

  it('Should show current login session', async () => {
    const command = `${binChectl} auth:get --telemetry=off`

    const { exitCode, stdout, stderr } = await execa(command, { shell: true })

    expect(exitCode).equal(0)
    expect(stdout).to.contain('admin')
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })
})

describe('Export CA certificate', () => {
  it('Export CA certificate', async () => {
    const command = `${binChectl} cacert:export -n ${NAMESPACE} --telemetry=off`

    const { exitCode, stdout, stderr } = await execa(command, { shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })
})

describe('Workspace creation, list, start, inject, delete. Support stop and delete commands for Eclipse Che server', () => {
  describe('Create workspace', () => {
    it('Testing workspace:create command', async () => {
      console.log('>>> Testing workspace:create command')

      const { exitCode, stdout, stderr, } = await execa(binChectl, ['workspace:create', `--devfile=${DEVFILE_URL}`, '--telemetry=off', `-n ${NAMESPACE}`], { shell: true })
      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('Start Workspace', () => {
    it('Testing workspace:start command', async () => {
      console.log('>>> Testing workspace:start command')

      const workspaceId = await helper.getWorkspaceId()
      const { exitCode, stdout, stderr, } = await execa(binChectl, ['workspace:start', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'], { shell: true })
      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)

      // Wait for workspace start 7 minutes.
      // NOTE: Put 7 minutes because in GH actions minikube cluster we have lower memory and workspace creation can take some time
      const desiredStatus = await helper.waitWorkspaceStatus('RUNNING', 450000)
      expect(desiredStatus).to.be.true
    })
  })

  describe('Get workspace logs', () => {
    it('Testing workspace:logs command', async () => {
      console.log('>>> Testing workspace:logs command')
      const workspaceId = await helper.getWorkspaceId()
      const { exitCode, stdout, stderr } = await execa(binChectl, ['workspace:logs', `--workspace ${workspaceId}`, `-n ${WORKSPACE_NAMESPACE}`, `-d ${LOGS_DIR}`, '--telemetry=off'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('Inject kubeconfig to workspaces', () => {
    it('Testing workspace:inject command', async () => {
      console.log('>>> Testing workspace:inject command')

      const { exitCode, stdout, stderr } = await execa(binChectl, ['workspace:inject', '--kubeconfig', `-n ${NAMESPACE}`, '--telemetry=off'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('List Workspace', () => {
    test
      .stdout({ print: true })
      .stderr({ print: true })
      .it('List workspaces', async () => {
        console.log('>>> Testing workspace:list command')
        const { exitCode, stdout, stderr } = await execa(binChectl, ['workspace:list', `--chenamespace=${NAMESPACE}`, '--telemetry=off'], { shell: true })

        console.log(`stdout: ${stdout}`)
        console.log(`stderr: ${stderr}`)
        expect(exitCode).equal(0)
      })
  })

  describe('Get Eclipse Che server status', () => {
    test
      .stdout({ print: true })
      .stderr({ print: true })
      .it('Get Che Server status', async () => {
        console.log('>>> Testing server:status command')

        const { exitCode, stdout, stderr } = await execa(binChectl, ['server:status', `--chenamespace=${NAMESPACE}`, '--telemetry=off'], { shell: true })

        console.log(`stdout: ${stdout}`)
        console.log(`stderr: ${stderr}`)
        expect(exitCode).equal(0)
      })
  })

  describe('Stop Workspace', () => {
    it('Testing workspace:stop command', async () => {
      console.log('>>> Testing workspace:stop command')

      const workspaceId = await helper.getWorkspaceId()
      const { exitCode, stdout, stderr } = await execa(binChectl, ['workspace:stop', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)

      const workspaceStatus = await helper.getWorkspaceStatus()
      // The status could be STOPPING or STOPPED
      expect(workspaceStatus).to.contain('STOP')
    })
  })

  describe('Delete Workspace', () => {
    it('Testing workspace:delete command', async () => {
      console.log('>>> Testing workspace:delete command')

      const workspaceId = await helper.getWorkspaceId()
      const { exitCode, stdout, stderr } = await execa(binChectl, ['workspace:delete', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('Get Eclipse Che server logs', () => {
    it('Testing server:logs command', async () => {
      console.log('>>> Testing server:logs command')

      const { exitCode, stdout, stderr } = await execa(binChectl, ['server:logs', `-d ${LOGS_DIR}`, '--telemetry=off'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('Stop Eclipse Che server', () => {
    it('server:stop command coverage', async () => {
      console.log('>>> Testing server:stop command')

      const { exitCode, stdout, stderr } = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      expect(exitCode).equal(0)
    })
  })

  describe('Delete Eclipse Che server', () => {
    it('server:delete command coverage', async () => {
      console.log('>>> Testing server:delete command')

      let result = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

      console.log(`stdout: ${result.stdout}`)
      console.log(`stderr: ${result.stderr}`)
      expect(result.exitCode).equal(0)

      // run server:delete twice
      result = await execa(binChectl, ['server:delete', `-n ${NAMESPACE}`, '--telemetry=off', '--delete-namespace', '--yes'], { shell: true })

      console.log(`stdout: ${result.stdout}`)
      console.log(`stderr: ${result.stderr}`)
      expect(result.exitCode).equal(0)
    })
  })
})
