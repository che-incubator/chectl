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
import { E2eHelper, NAMESPACE } from './util'

const helper = new E2eHelper()
jest.setTimeout(1000000)

const binChectl = E2eHelper.getChectlBinaries()

const PLATFORM = process.env.PLATFORM || 'minikube'

const INSTALLER = 'operator'

const UPDATE_CHE_TIMEOUT_MS = 10 * 60 * 1000
const CHE_VERSION_TIMEOUT_MS = 10 * 60 * 1000

describe('Test Che upgrade', () => {
  let cheVersion: string

  describe('Prepare latest stable Che', () => {
    it(`Deploy Che using ${INSTALLER} installer and self signed certificates`, async () => {
      // Retrieve latest stable Che version
      cheVersion = await helper.getLatestReleasedVersion()

      const deployCommand = `${binChectl} server:deploy --platform=${PLATFORM} --installer=${INSTALLER} --version=${cheVersion} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      await helper.runCliCommand(deployCommand)

      await helper.waitForVersionInCheCR(cheVersion, CHE_VERSION_TIMEOUT_MS)
    })
  })

  describe('Test Che update', () => {
    it('Update Eclipse Che Version', async () => {
      await helper.runCliCommand(binChectl, ['server:update', '-y', `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitForCheServerImageTag(helper.getNewVersion(), UPDATE_CHE_TIMEOUT_MS)
    })

    it('Check updated Che version', async () => {
        await helper.waitForVersionInCheCR(helper.getNewVersion(), CHE_VERSION_TIMEOUT_MS)
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
