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

import { expect, test } from '@oclif/test'
import * as execa from 'execa'

import { E2eHelper } from './util/e2e'
const helper = new E2eHelper()
jest.setTimeout(600000)

const binChectl = `${process.cwd()}/bin/run`

describe('Eclipse Che deploy test suite', () => {
  describe('server:deploy using operator and self signed certificates', () => {
    test
      .stdout({ print: true })
      .stderr({ print: true })
      .command(['server:deploy', '--platform=minikube', '--che-operator-cr-patch-yaml=test/e2e/util/cr-test.yaml', '--tls', '--installer=operator', '--skip-cluster-availability-check'])
      .exit(0)
      .it('uses minikube as platform, operator as installer and auth is enabled')
  })
})

describe('Che server authentication', () => {
  it('Should login in to Che server with username and password', async () => {
    const cheApiEndpoint = await helper.K8SHostname('che') + '/api'

    const command = `${binChectl} auth:login`
    const args = [cheApiEndpoint, '-u', 'admin', '-p', 'admin']

    const { exitCode, stdout, stderr } = await execa(command, args, { timeout: 30000, shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })

  it('Should show current login session', async () => {
    const command = `${binChectl} auth:get`

    const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })
})

describe('Export CA certificate', () => {
  it('Export CA certificate', async () => {
    const command = `${binChectl} cacert:export`

    const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })

    expect(exitCode).equal(0)
    console.log(stdout)

    if (exitCode !== 0) {
      console.log(stderr)
    }
  })
})

describe('Workspace creation, list, start, inject, delete. Support stop and delete commands for Eclipse Che server', () => {
  describe('Create Workspace', () => {
    test
      .stdout({ print: true })
      .stderr({ print: true })
      .command(['workspace:create', '--devfile=test/e2e/util/devfile-example.yaml'])
      .exit(0)
      .it('Create a workspace and wait to be started')
  })

  describe('Start Workspace', () => {
    it('Start a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId()
      const command = `${binChectl} workspace:start ${workspaceId}`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })

      expect(exitCode).equal(0)
      console.log(stdout)

      // Sleep time to wait to workspace to be running
      await helper.SleepTests(200000)
      if (exitCode !== 0) {
        console.log(stderr)
      }

      const workspaceStatus = await helper.getWorkspaceStatus()

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
      .stderr({ print: true })
      .command(['workspace:list'])
      .it('List workspaces')
  })

  describe('Server Status', () => {
    test
      .stdout({ print: true })
      .stderr({ print: true })
      .command(['server:status'])
      .it('Get Che Server status')
  })

  describe('Stop Workspace', () => {
    it('Stop a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId()
      const command = `${binChectl} workspace:stop ${workspaceId}`

      const { exitCode, stdout, stderr } = await execa(command, { timeout: 30000, shell: true })
      expect(exitCode).equal(0)

      console.log(stdout)

      if (exitCode !== 0) {
        console.log(stderr)
      }

      const workspaceStatus = await helper.getWorkspaceStatus()
      // The status could be STOPPING or STOPPED
      expect(workspaceStatus).to.contain('STOP')
    })
  })

  describe('Delete Workspace', () => {
    it('Delete a workspace using execa library', async () => {
      const workspaceId = await helper.getWorkspaceId()
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
      .stderr({ print: true })
      .do(async () => helper.SleepTests(30000))
      .command(['server:stop', '--listr-renderer=verbose'])
      .exit(0)
      .it('Stop Eclipse Che Server on minikube platform')
  })

  describe('Delete Eclipse Che Server', () => {
    test
      .stdout()
      .stderr({ print: true })
      .command(['server:delete', '--yes', '--delete-namespace'])
      .exit(0)
      .it('deletes Eclipse Che resources on minikube successfully')
  })
})
