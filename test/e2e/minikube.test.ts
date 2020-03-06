/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { expect, test } from '@oclif/test'

jest.setTimeout(600000)

describe('e2e test', () => {
  describe('server:start without parameters', () => {
    test
      .stdout()
      .command(['server:start', '--platform=minikube', '--installer=operator'])
      .exit(0)
      .it('uses minikube as platform, operator as installer and auth is enabled', ctx => {
        expect(ctx.stdout).to.contain('Minikube preflight checklist')
          .and.to.contain('Running the Eclipse Che operator')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .skip()
      .stdout()
      .command(['server:stop'])
      .exit(0)
      .it('stops Server on minikube successfully')
    test
      .stdout()
      .command(['server:delete', '--skip-deletion-check'])
      .exit(0)
      .it('deletes Eclipse Che resources on minikube successfully')
  })
})
