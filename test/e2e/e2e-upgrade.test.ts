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

import { expect } from '@oclif/test'
import * as execa from 'execa'

import { CheGithubClient } from '../../src/api/github-client'
import { KubeHelper } from '../../src/api/kube'
import { isKubernetesPlatformFamily } from '../../src/util'

import { DEVFILE_URL, E2eHelper } from './util'

const kube = new KubeHelper()
const helper = new E2eHelper()
jest.setTimeout(1000000)

const binChectl = `${process.cwd()}/bin/run`

const PLATFORM = process.env.PLATFORM || 'minikube'

const INSTALLER = 'operator'
const NAMESPACE = 'eclipse-che'

const NIGHTLY = 'nightly'

const UPDATE_CHE_TIMEOUT_MS = 5 * 60 * 1000
const WORKSPACE_START_TIMEOUT_MS = 5 * 60 * 1000
const CHE_VERSION_TIMEOUT_MS = 50 * 1000

async function runCommand(command: string, args?: string[]): Promise<string> {
  console.log(`Running command: ${command} ${args ? args.join(' ') : ''}`)
  const { exitCode, stdout, stderr } = await execa(command, args, { shell: true })
  console.log(stdout)
  if (exitCode !== 0) {
    console.log(stderr)
  }

  expect(exitCode).equal(0)

  return stdout
}

async function waitForVersionInCheCR(version: string, timeoutMs: number): Promise<boolean> {
  const delayMs = 5 * 1000

  let totalTimeMs = 0
  while (totalTimeMs < timeoutMs) {
    const cheCR = await kube.getCheCluster(NAMESPACE)
    if (cheCR.status.cheVersion === version) {
      return true
    }
    await helper.sleep(delayMs)
    totalTimeMs += delayMs
  }
  return false
}

async function waitForCheServerImageTag(tag: string, timeoutMs: number): Promise<boolean> {
  const delayMs = 5 * 1000
  const chePodNameRegExp = new RegExp('che-[0-9a-f]+-.*')

  let totalTimeMs = 0
  while (totalTimeMs < timeoutMs) {
    const pods = (await kube.listNamespacedPod(NAMESPACE)).items
    const pod = pods.find((pod => pod.metadata && pod.metadata.name && pod.metadata.name.match(chePodNameRegExp)))
    if (pod && pod.status && pod.status.containerStatuses && pod.status.containerStatuses[0].image) {
      const imageTag = pod.status.containerStatuses[0].image.split(':')[1]
      if (imageTag === tag) {
        return true
      }
    }
    await helper.sleep(delayMs)
    totalTimeMs += delayMs
  }
  return false
}

describe('Test Che upgrade', () => {
  let cheVersion: string

  describe('Prepare latest stable Che', () => {
    it(`Deploy Che using ${INSTALLER} installer and self signed certificates`, async () => {
      // Retrieve latest stable Che version
      const githubClient = new CheGithubClient()
      const latestStableCheTag = (await githubClient.getTemplatesTagInfo(INSTALLER, 'latest'))!
      cheVersion = latestStableCheTag.name

      const deployCommand = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --version=${cheVersion} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      await runCommand(deployCommand)

      expect(await waitForVersionInCheCR(cheVersion, CHE_VERSION_TIMEOUT_MS)).equal(true)
    })

    it('Prepare test workspace', async () => {
      await loginTest()

      // Create
      await runCommand(binChectl, ['workspace:create', `--devfile=${DEVFILE_URL}`, '--telemetry=off', `-n ${NAMESPACE}`])
      const workspaceId = await helper.getWorkspaceId()

      // Start
      await runCommand(binChectl, ['workspace:start', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      expect(await helper.waitWorkspaceStatus('RUNNING', WORKSPACE_START_TIMEOUT_MS)).to.equal(true)

      // Stop
      await runCommand(binChectl, ['workspace:stop', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      const workspaceStatus = await helper.getWorkspaceStatus()
      // The status could be STOPPING or STOPPED
      expect(workspaceStatus).to.contain('STOP')
    })
  })

  describe('Test Che update', () => {
    it('Update Che to nightly version', async () => {
      await runCommand(binChectl, ['server:update', '-y', `-n ${NAMESPACE}`, '--telemetry=off'])
      expect(await waitForCheServerImageTag(NIGHTLY, UPDATE_CHE_TIMEOUT_MS)).equal(true)
    })

    it('Check updated Che version', async () => {
      expect(await waitForVersionInCheCR(NIGHTLY, CHE_VERSION_TIMEOUT_MS)).equal(true)
    })
  })

  describe('Test updated Che', () => {
    it('Start existing workspace after update', async () => {
      // Relogin
      await loginTest()

      const workspaceId = await helper.getWorkspaceId()
      await runCommand(binChectl, ['workspace:start', workspaceId, `-n ${NAMESPACE}`, '--telemetry=off'])
      expect(await helper.waitWorkspaceStatus('RUNNING', WORKSPACE_START_TIMEOUT_MS)).to.equal(true)
    })
  })

  describe('Test Che downgrade', () => {
    it('Downgrade Che', async () => {
      await runCommand(binChectl, ['server:update', '-y', `--version=${cheVersion}`, `-n ${NAMESPACE}`, '--telemetry=off'])
      expect(await waitForCheServerImageTag(cheVersion, UPDATE_CHE_TIMEOUT_MS)).equal(true)
    })

    it('Check downgraded Che version', async () => {
      expect(await waitForVersionInCheCR(cheVersion, CHE_VERSION_TIMEOUT_MS)).equal(true)
    })
  })

})

async function loginTest() {
  let cheApiEndpoint: string
  if (isKubernetesPlatformFamily(PLATFORM)) {
    cheApiEndpoint = await helper.K8SHostname('che', NAMESPACE) + '/api'
  } else {
    cheApiEndpoint = await helper.OCHostname('che', NAMESPACE) + '/api'
  }

  const stdout = await runCommand(binChectl, ['auth:login', cheApiEndpoint, '-u', 'admin', '-p', 'admin', '-n', `${NAMESPACE}`, '--telemetry=off'])
  expect(stdout).to.contain('Successfully logged into')
}
