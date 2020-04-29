/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { expect, test } from '@oclif/test'

import { E2eHelper } from './util/e2e'

const helper = new E2eHelper()
jest.setTimeout(600000)

const execution_platform = 'openshift'

describe('Eclipse Che deploy test suite', () => {
  describe('server:start using operator and self signed certificates', () => {
    test
      .stdout({ print: true })
      .command(['server:start', '--platform=minishift', '--tls', '--self-signed-cert', '--installer=operator'])
      .exit(0)
      .it('uses minishift as platform, operator as installer and auth is enabled', ctx => {
        expect(ctx.stdout).to.contain('Minishift preflight checklist')
          .and.to.contain('Running the Eclipse Che operator')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .it('Obtain access_token from keycloak and set it like environment variable.', async () => {
        const token = await helper.Access_Token(execution_platform)
        process.env.CHE_ACCESS_TOKEN = token
      })
  })
})

describe('Workspace creation, list, start, inject, delete. Support stop and delete commands for Eclipse Che server', () => {
  const wait = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))

  // !TODO ADD coverage for next commands: workspace:delete and workspace:inject
  describe('Create Workspace', () => {
    test
      .stdout({ print: true })
      .command(['workspace:create', '--start', '--devfile=test/e2e/util/devfile-example.yaml'])
      .exit(0)
      .it('Create a workspace and wait to be started', async () => {
        await wait(200000)
        const workspace = await helper.WorkspaceID(execution_platform)
        expect(workspace[0].status).to.contain('RUNNING')
      })
  })

  describe('workspace:list List info about created workspaces', () => {
    test
      .stdout({ print: true })
      .command(['workspace:list'])
      .it('List workspaces')
  })

  describe('server:stop Stop Eclipse Che Server', () => {
    test
      .stdout({ print: true })
      .command(['server:stop'])
      .exit(0)
      .it('Stop Eclipse Che Server on minishift platform')
  })
  describe('server:delete Delete Eclipse Che Server', () => {
    test
      .stdout()
      .command(['server:delete', '--skip-deletion-check'])
      .exit(0)
      .it('deletes Eclipse Che resources on minishift successfully')
  })
})
