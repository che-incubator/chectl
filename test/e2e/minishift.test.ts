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
import * as execa from 'execa'

import { E2eHelper } from './util/e2e'

const helper = new E2eHelper()
jest.setTimeout(600000)

const PLATFORM = 'openshift'

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
        const token = await helper.getAccessToken(PLATFORM)
        process.env.CHE_ACCESS_TOKEN = token
      })
  })
})


describe('Workspace creation, list, start, inject, delete. Support stop and delete commands for Eclipse Che server', () => {
  const binChectl = `${process.cwd()}/bin/run`

  describe('Create Workspace', () => {
    test
      .stdout({ print: true })
      .command(['workspace:create', '--devfile=test/e2e/util/devfile-example.yaml'])
      .exit(0)
      .it('Create a workspace and wait to be started')
  })

  describe('Start Workspace', () => {
    it('Start a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId(PLATFORM)
      const command = `${binChectl} workspace:start ${workspaceId}`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })

      expect(exitCode).equal(0)
      console.log(stdout)

      // Sleep time to wait to workspace to be running
      await helper.SleepTests(200000)
      if (exitCode !== 0) {
        console.log(stderr)
      }

      const workspaceStatus = await helper.GetWorkspaceStatus(PLATFORM)

      expect(workspaceStatus).to.contain('RUNNING')
    })
  })

  describe('Inject kubeconfig to workspaces', () => {
    it('Inject kubeconfig to workspaces', async () => {
      const command = `${binChectl} workspace:inject --kubeconfig`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })

      expect(exitCode).equal(0)
      console.log(stdout)

      if (exitCode !== 0) {
        console.log(stderr)
      }
    })
  })

  describe('List Workspace', () => {
    test
      .stdout({ print: true })
      .command(['workspace:list'])
      .it('List workspaces')
  })

  describe('Stop Workspace', () => {
    it('Stop a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId(PLATFORM)
      const command = `${binChectl} workspace:stop ${workspaceId}`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })
      expect(exitCode).equal(0)

      console.log(stdout)

      if (exitCode !== 0) {
        console.log(stderr)
      }
    })
  })

  describe('Delete Workspace', () => {
    it('Delete a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId(PLATFORM)
      const command = `${binChectl} workspace:delete ${workspaceId}`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })
      expect(exitCode).equal(0)

      console.log(stdout)

      if (exitCode !== 0) {
        console.log(stderr)
      }
    })
  })

  describe('Stop Eclipse Che Server', () => {
    test
      .stdout({ print: true })
      .do(async () => helper.SleepTests(30000))
      .command(['server:stop'])
      .exit(0)
      .it('Stop Eclipse Che Server on minikube platform')
  })

  describe('Delete Eclipse Che Server', () => {
    test
      .stdout()
      .command(['server:delete', '--skip-deletion-check'])
      .exit(0)
      .it('deletes Eclipse Che resources on minikube successfully')
  })
})
