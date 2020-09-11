/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { expect, fancy } from 'fancy-test'

import { CheApiClient } from '../../src/api/che-api-client'

const cheApiEndpoint = 'https://che-che.192.168.64.34.nip.io/api'
const devfileEndpoint = '/workspace/devfile'
let cheApiClient = CheApiClient.getInstance(cheApiEndpoint)

describe('Eclipse Che Server API client', () => {
  describe('isCheServerReady', () => {
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/system/state')
        .reply(200))
      .it('detects if Eclipse Che server is ready', async () => {
        const res = await cheApiClient.isCheServerReady()
        expect(res).to.equal(true)
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/system/state')
        .delayConnection(1000)
        .reply(200))
      .it('detects if Eclipse Che server is NOT ready', async () => {
        const res = await cheApiClient.isCheServerReady(500)
        expect(res).to.equal(false)
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/system/state')
        .delayConnection(1000)
        .reply(200))
      .it('waits until Eclipse Che server is ready', async () => {
        const res = await cheApiClient.isCheServerReady(2000)
        expect(res).to.equal(true)
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/system/state')
        .reply(404)
        .get('/system/state')
        .reply(503)
        .get('/system/state')
        .reply(200))
      .it('continues requesting until Eclipse Che server is ready', async () => {
        const res = await cheApiClient.isCheServerReady(2000)
        expect(res).to.equal(true)
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/system/state')
        .reply(404)
        .get('/system/state')
        .reply(404)
        .get('/system/state')
        .reply(503))
      .it('continues requesting but fails if Eclipse Che server is NOT ready after timeout', async () => {
        const res = await cheApiClient.isCheServerReady(20)
        expect(res).to.equal(false)
      })
  })
  describe('createWorkspaceFromDevfile', () => {
    fancy
      .nock(cheApiEndpoint, api => api
        .post(devfileEndpoint)
        .replyWithFile(201, __dirname + '/replies/create-workspace-from-valid-devfile.json', { 'Content-Type': 'application/json' }))
      .it('succeds creating a workspace from a valid devfile', async () => {
        const res = await cheApiClient.createWorkspaceFromDevfile(__dirname + '/requests/devfile.valid')
        expect(res.links!.ide).to.equal('https://che-che.192.168.64.39.nip.io/che/chectl')
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .post(devfileEndpoint)
        .replyWithFile(400, __dirname + '/replies/create-workspace-from-invalid-devfile.json', {
          'Content-Type': 'application/json'
        }))
      .do(() => cheApiClient.createWorkspaceFromDevfile(__dirname + '/requests/devfile.invalid'))
      .catch(/E_BAD_DEVFILE_FORMAT/)
      .it('fails creating a workspace from an invalid devfile')
  })
  describe('isAuthenticationEnabled', () => {
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/keycloak/settings')
        .replyWithFile(200, __dirname + '/replies/get-keycloak-settings.json', {
          'Content-Type': 'application/json'
        }))
      .it('should return true if the api/keycloak/settings endpoint exist', async () => {
        const authEnabled = await cheApiClient.isAuthenticationEnabled()
        expect(authEnabled).to.equal(true)
      })
    fancy
      .nock(cheApiEndpoint, api => api
        .get('/keycloak/settings')
        .reply(404, 'Page does not exist', {
          'Content-Type': 'text/plain'
        }))
      .it('should return false if the api/keycloak/settings endpoint doesn\'t exist', async () => {
        const authEnabled = await cheApiClient.isAuthenticationEnabled()
        expect(authEnabled).to.equal(false)
      })
  })
})
