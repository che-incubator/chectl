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
import {EclipseChe} from "../../src/tasks/installers/eclipse-che/eclipse-che";

const helper = new E2eHelper()
jest.setTimeout(1000000)

const PLATFORM = process.env.PLATFORM || 'minikube'

const TIMEOUT_MS = 15 * 60 * 1000

describe('Upgrade channel test', () => {
  describe('Deploy Eclipse Che from stable channel and then upgrade to next ', () => {
    it(`Deploy Eclipse Che from stable channel`, async () => {
      const binChectl = E2eHelper.getChectlBinaries()
      await helper.runCliCommand(binChectl, [
        'server:deploy',
        '--batch',
        `--platform=${PLATFORM}`,
        `--chenamespace=${EclipseChe.NAMESPACE}`,
        '--che-operator-cr-patch-yaml=test/e2e/resources/minikube-checluster-patch.yaml',
        '--telemetry=off',
        '--k8spodwaittimeout=240000',
        '--k8spodreadytimeout=240000',
      ])

      await helper.waitForCheServerImageTag(helper.getNewVersion(), TIMEOUT_MS)
      // uses installed chectl (from a stable channel)
      // see github workflow
      let deployCommand = `chectl server:deploy --batch --platform=${PLATFORM} --chenamespace=${NAMESPACE} --telemetry=off`
      if (PLATFORM === 'minikube') {
        deployCommand += ' --che-operator-cr-patch-yaml=test/e2e/resources/minikube-checluster-patch.yaml'
      }
      await helper.runCliCommand(deployCommand)
    })

    it('Upgrade Eclipse Che to next channel', async () => {
      const binChectl = E2eHelper.getChectlBinaries()
      // scale deployments down to free up some resources
      await helper.runCliCommand('kubectl', ['scale', 'deployment', 'che', '--replicas=0', `-n ${NAMESPACE}`])

      await helper.runCliCommand(binChectl, [
        'server:update',
        '--batch',
        '--olm-channel=next',
        '--telemetry=off'
      ])
    })

    it('Check Eclipse Che version', async () => {
      await helper.waitForVersionInCheCR(helper.getNewVersion(), TIMEOUT_MS)
    })
  })
})
