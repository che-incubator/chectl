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

/*
## Before
PROFILE=chectl-e2e-tests
minikube start --memory=8192 -p ${PROFILE}
minikube profile ${PROFILE}

yarn test --coverage=false --testRegex=/test/e2e/minikube.test.ts

## After
minikube stop -p ${PROFILE}
minikube delete -p ${PROFILE}
*/

describe('e2e test', () => {
  describe('server:start without parameters', () => {
    test
      .stdout({print: true})
      .command(['server:start', '--platform=minikube', '--installer=operator'])
      .exit(0)
      .it('uses minikube as platform, helm as installer and auth is disabled', ctx => {
        expect(ctx.stdout).to.contain('Minikube preflight checklist')
          .and.to.contain('Running Helm to install Eclipse Che')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .skip()
      .stdout({print: true})
      .command(['server:stop', '--listr-renderer=verbose'])
      .exit(0)
      .it('stops Server on minikube successfully')
    test
      .stdout({print: true})
      .command(['server:delete','--skip-deletion-check', '--listr-renderer=verbose'])
      .exit(0)
      .it('deletes Eclipse Che resources on minikube successfully')
  })
})
