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

import { expect, fancy } from 'fancy-test'
import { K8sVersion } from '../../src/utils/k8s-version'
import { CheCtlVersion } from '../../src/utils/chectl-version'

describe('Version Helper', () => {
  describe('OpenShift API helper', () => {
    fancy
      .it('check minimal version: case #1', async () => {
        const check = K8sVersion.checkMinimalVersion('v2.10', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #2', async () => {
        const check = K8sVersion.checkMinimalVersion('v3.12', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #3', async () => {
        const check = K8sVersion.checkMinimalVersion('v2.11', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #4', async () => {
        const check = K8sVersion.checkMinimalVersion('v2.09', 'v2.10')
        expect(check).to.false
      })
    fancy
      .it('check minimal version: case #5', async () => {
        const check = K8sVersion.checkMinimalVersion('v2.10', 'v3.10')
        expect(check).to.false
      })
  })

  describe('chectl version comparator', () => {
    function getCommitDateFakeResponse(commitDate: string) {
      return {
        commit: {
          committer: {
            date: commitDate
          }
        }
      }
    }

    // Node 18+ provides globalThis.fetch (Undici). @octokit/request uses it when present,
    // so nock (which only intercepts Node's https) never sees the request. Temporarily
    // remove globalThis.fetch so @octokit/request falls back to node-fetch and nock works.
    let originalFetch: typeof globalThis.fetch
    beforeEach(() => {
      originalFetch = globalThis.fetch
      delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch
    })
    afterEach(() => {
      (globalThis as { fetch?: typeof globalThis.fetch }).fetch = originalFetch
    })

    fancy
      .it('should update stable version', async () => {
        const currentVersion = '7.30.2'
        const newVersion = '7.31.1'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.true
      })
    fancy
      .it('should not update stable version', async () => {
        const currentVersion = '7.30.2'
        const newVersion = '7.30.2'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.false
      })
    fancy
      .it('should not downgrade stable version', async () => {
        const currentVersion = '7.31.1'
        const newVersion = '7.30.2'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.false
      })
    fancy
      .it('should update next version (release day differs)', async () => {
        const currentVersion = '0.0.20210727-next.81f31b0'
        const newVersion = '0.0.20210729-next.6041615'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.true
      })
    fancy
      .it('should not update next version (release day differs)', async () => {
        const currentVersion = '0.0.20210729-next.6041615'
        const newVersion = '0.0.20210729-next.6041615'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.false
      })
    fancy
      .it('should not downgrade next version (release day differs)', async () => {
        const currentVersion = '0.0.20210729-next.6041615'
        const newVersion = '0.0.20210727-next.81f31b0'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.false
      })
    fancy
      .nock('https://api.github.com/repos/che-incubator/chectl/commits', api => api
        .get('/597729a').reply(200, getCommitDateFakeResponse('2021-07-15T08:20:00Z'))
        .get('/4771039').reply(200, getCommitDateFakeResponse('2021-07-15T09:45:37Z'))
      )
      .it('should update next version (release day the same)', async () => {
        const currentVersion = '0.0.20210715-next.597729a'
        const newVersion = '0.0.20210715-next.4771039'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.true
      })
    fancy
      .nock('https://api.github.com/repos/che-incubator/chectl/commits', api => api
        .get('/597729a').reply(200, getCommitDateFakeResponse('2021-07-15T08:20:00Z'))
        .get('/4771039').reply(200, getCommitDateFakeResponse('2021-07-15T09:45:37Z'))
      )
      .it('should not downgrade next version (release day the same)', async () => {
        const currentVersion = '0.0.20210715-next.4771039'
        const newVersion = '0.0.20210715-next.597729a'
        const shouldUpdate = await CheCtlVersion.gtCheCtlVersion(newVersion, currentVersion)
        expect(shouldUpdate).to.be.false
      })
  })
})
