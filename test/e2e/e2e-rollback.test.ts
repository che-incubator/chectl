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

const PLATFORM = process.env.PLATFORM || 'openshift'
const INSTALLER = process.env.INSTALLER || 'olm'
const OLM_CHANNEL = process.env.OLM_CHANNEL || 'stable'

const CHE_VERSION_TIMEOUT_MS = 12 * 60 * 1000
const CHE_BACKUP_TIMEOUT_MS = 2 * 60 * 1000

describe('Test rollback Che update', () => {
  let previousCheVersion: string
  let latestCheVersion: string

  describe('Prepare pre-latest stable Che', () => {
    it(`Deploy Che using ${INSTALLER} installer from ${OLM_CHANNEL} channel`, async () => {
      // Retrieve pre-latest and latest stable Che version
      [previousCheVersion, latestCheVersion] = await helper.getTwoLatestReleasedVersions(INSTALLER)

      let deployCommand = `${binChectl} server:deploy --batch --platform=${PLATFORM} --installer=${INSTALLER} --version=${previousCheVersion} --chenamespace=${NAMESPACE} --telemetry=off --che-operator-cr-patch-yaml=test/e2e/resources/cr-patch.yaml`
      if (INSTALLER === 'olm') {
        deployCommand += ` --olm-channel=${OLM_CHANNEL}`
      }
      await helper.runCliCommand(deployCommand)

      await helper.waitForVersionInCheCR(previousCheVersion, CHE_VERSION_TIMEOUT_MS)
    })
  })

  describe('Update Che to the latest stable version', () => {
    it('Update Eclipse Che Version to the latest', async () => {
      console.log(`Updating from ${previousCheVersion} to ${latestCheVersion}`)

      let updateCommand = `${binChectl} server:update -y -n ${NAMESPACE} --telemetry=off`
      if (INSTALLER === 'operator') {
        // It is required to specify version for Operator installer, otherwise it will update Che to next as chectl is of next version
        updateCommand += ` --version=${latestCheVersion}`
      }
      await helper.runCliCommand(updateCommand)
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
      await helper.waitForVersionInCheCR(previousCheVersion, 5 * 60 * 1000)
    })
  })
})
