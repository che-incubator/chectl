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

const UPDATE_CHE_TIMEOUT_MS = 10 * 60 * 1000
const CHE_VERSION_TIMEOUT_MS = 10 * 60 * 1000

describe('Test Che upgrade', () => {
  describe('Prepare latest stable Che', () => {
    it(`Deploy Che using operator installer and self signed certificates`, async () => {
      // uses installed chectl (from a stable channel)
      // see github workflow
      const deployCommand = `chectl server:deploy --batch --platform=openshift --chenamespace=${NAMESPACE} --telemetry=off`
      await helper.runCliCommand(deployCommand)
    })
  })

  describe('Test Che update', () => {
    it('Update Eclipse Che Version', async () => {
      const binChectl = E2eHelper.getChectlBinaries()
      // scale deployments down to free up some resources
      await helper.runCliCommand('kubectl', ['scale', 'deployment', 'che', '--replicas=0', `-n ${NAMESPACE}`])

      await helper.runCliCommand(binChectl, ['server:update', '-y', `-n ${NAMESPACE}`, '--telemetry=off'])
      await helper.waitForCheServerImageTag(helper.getNewVersion(), UPDATE_CHE_TIMEOUT_MS)
    })

    it('Check updated Che version', async () => {
        await helper.waitForVersionInCheCR(helper.getNewVersion(), CHE_VERSION_TIMEOUT_MS)
    })
  })
})
