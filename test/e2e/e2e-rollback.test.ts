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
import { E2eHelper, NAMESPACE } from './util'

const helper = new E2eHelper()
jest.setTimeout(1000000)

const binChectl = E2eHelper.getChectlBinaries()

const PLATFORM = process.env.PLATFORM || 'minikube'

const INSTALLER = 'olm'
const OLM_CHANNEL = 'stable'

const CHE_VERSION_TIMEOUT_MS = 12 * 60 * 1000
const CHE_BACKUP_TIMEOUT_MS = 2 * 60 * 1000

describe('Test rollback Che update', () => {
  let previousCheVersion: string
  let latestCheVersion: string

  describe('Prepare pre-latest stable Che', () => {
    it(`Deploy Che using ${INSTALLER} installer from ${OLM_CHANNEL} channel`, async () => {
      // Retrieve pre-latest and latest stable Che version
      [previousCheVersion, latestCheVersion] = await helper.getTwoLatestReleasedVersions()

      const deployCommand = `${binChectl} server:deploy --batch --platform=${PLATFORM} --installer=${INSTALLER} --olm-channel=${OLM_CHANNEL} --version=${previousCheVersion} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      await helper.runCliCommand(deployCommand)

      await helper.waitForVersionInCheCR(previousCheVersion, CHE_VERSION_TIMEOUT_MS)
    })
  })

  describe('Update Che to the latest stable version', () => {
    it('Update Eclipse Che Version to the latest', async () => {
      console.log(`Updating from ${previousCheVersion} to ${latestCheVersion}`)

      await helper.runCliCommand(binChectl, ['server:update', '-y', `-n ${NAMESPACE}`, '--telemetry=off'])
    })

    it('Wait backup done', async () => {
      const backupCrName = 'backup-before-update-to-' + latestCheVersion.replace(/\./g, '-')
      await helper.waitForSuccessfulBackup(backupCrName, CHE_BACKUP_TIMEOUT_MS)
    })

    it('Wait updated Che version', async () => {
      await helper.waitForVersionInCheCR(latestCheVersion, CHE_VERSION_TIMEOUT_MS)
      // Wait some time to reconcile old resources
      await helper.sleep(60 * 1000)
    })
  })

  describe('Rollback Che update', () => {
    it('Rollback Che to the previous version', async () => {
      console.log(`Rolling back from ${latestCheVersion} to ${previousCheVersion}`)

      await helper.runCliCommandVerbose(binChectl, ['server:restore', '--batch', '--rollback', '-n', NAMESPACE, '--telemetry=off'])
    })

    it('Wait previous Che', async () => {
      // It is possible to reduce awaiting timeout, because rollback itself waits for the restore to complete.
      await helper.waitForVersionInCheCR(previousCheVersion, 2 * 60 * 1000)
    })
  })
})
