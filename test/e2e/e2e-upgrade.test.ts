/*********************************************************************
 * Copyright (c) 2021 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

// tslint:disable: no-console

import { expect } from '@oclif/test'

import { CheGithubClient } from '../../src/api/github-client'
import { isKubernetesPlatformFamily } from '../../src/util'

import { DEVFILE_URL, E2eHelper, NAMESPACE, NIGHTLY } from './util'

const helper = new E2eHelper()
jest.setTimeout(1000000)

const WORKSPACE_NAMESPACE = 'admin-che'
const LOGS_DIR = '/tmp/logs'

const binChectl = E2eHelper.getChectlBinaries()

const PLATFORM = process.env.PLATFORM || 'minikube'

const INSTALLER = 'operator'

const UPDATE_CHE_TIMEOUT_MS = 5 * 60 * 1000
const WORKSPACE_START_TIMEOUT_MS = 5 * 60 * 1000
const CHE_VERSION_TIMEOUT_MS = 50 * 1000

describe('Test Che upgrade', () => {
  let cheVersion: string

  describe('Prepare latest stable Che', () => {
    it(`Deploy Che using ${INSTALLER} installer and self signed certificates`, async () => {
      // Retrieve latest stable Che version
      const githubClient = new CheGithubClient()
      const latestStableCheTag = (await githubClient.getTemplatesTagInfo(INSTALLER, 'latest'))!
      cheVersion = latestStableCheTag.name

      const deployCommand = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --version=${cheVersion} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      await helper.runCliCommand(deployCommand)

      await helper.waitForVersionInCheCR(cheVersion, CHE_VERSION_TIMEOUT_MS)
    })

    it('Prepare test workspace', async () => {
      await runLoginTest()

      // Create
      await helper.runCliCommand(binChectl, ['workspace:create', `--devfile=${DEVFILE_URL}`, '--telemetry=off', `-n ${NAMESPACE}`])
      const workspaceId = await helper.getWorkspaceId()

      // Start
      await helper.runCliCommand(binChectl, ['workspace:start', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitWorkspaceStatus('RUNNING', WORKSPACE_START_TIMEOUT_MS)

      // Logs
      await helper.runCliCommand(binChectl, ['workspace:logs', `-w ${workspaceId}`, `-n ${WORKSPACE_NAMESPACE}`, `-d ${LOGS_DIR}`, '--telemetry=off'])

      // Stop
      await helper.runCliCommand(binChectl, ['workspace:stop', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      const workspaceStatus = await helper.getWorkspaceStatus()
      // The status could be STOPPING or STOPPED
      expect(workspaceStatus).to.contain('STOP')
    })
  })

  describe('Test Che update', () => {
    it('Update Che to nightly version', async () => {
      await helper.runCliCommand(binChectl, ['server:update', '-y', `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitForCheServerImageTag(NIGHTLY, UPDATE_CHE_TIMEOUT_MS)
    })

    it('Check updated Che version', async () => {
      await helper.waitForVersionInCheCR(NIGHTLY, CHE_VERSION_TIMEOUT_MS)
    })
  })

  describe('Test updated Che', () => {
    it('Start existing workspace after update', async () => {
      // Relogin
      await runLoginTest()

      const workspaceId = await helper.getWorkspaceId()
      await helper.runCliCommand(binChectl, ['workspace:start', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitWorkspaceStatus('RUNNING', WORKSPACE_START_TIMEOUT_MS)
    })
  })

  describe('Test Che downgrade', () => {
    it('Downgrade Che', async () => {
      await helper.runCliCommand(binChectl, ['server:update', '-y', `--version=${cheVersion}`, `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitForCheServerImageTag(cheVersion, UPDATE_CHE_TIMEOUT_MS)
    })

    it('Check downgraded Che version', async () => {
      await helper.waitForVersionInCheCR(cheVersion, CHE_VERSION_TIMEOUT_MS)
    })
  })

})

async function runLoginTest() {
  let cheApiEndpoint: string
  if (isKubernetesPlatformFamily(PLATFORM)) {
    cheApiEndpoint = await helper.K8SHostname('che', NAMESPACE) + '/api'
  } else {
    cheApiEndpoint = await helper.OCHostname('che', NAMESPACE) + '/api'
  }

  const stdout = await helper.runCliCommand(binChectl, ['auth:login', cheApiEndpoint, '-u', 'admin', '-p', 'admin', '-n', `${NAMESPACE}`, '--telemetry=off'])
  expect(stdout).to.contain('Successfully logged into')
}
