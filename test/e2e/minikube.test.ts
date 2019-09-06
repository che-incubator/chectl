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
      .stdout()
      .command(['server:start', '--listr-renderer=verbose'])
      .exit(0)
      .it('uses minikube as platform, helm as installer and auth is disabled', ctx => {
        expect(ctx.stdout).to.contain('Minikube preflight checklist')
          .and.to.contain('Running Helm')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .stdout()
      .command(['server:stop', '--listr-renderer=verbose'])
      .exit(0)
      .it('stops Server on minikube successfully')
    test
      .stdout()
      .command(['server:delete', '--listr-renderer=verbose'])
      .exit(0)
      .it('deletes Che resources on minikube successfully')
  })
  describe('server:start mulituser', () => {
    test
      .stdout()
      .command(['server:start', '--listr-renderer=verbose', '--multiuser'])
      .exit(0)
      .it('uses minikube as platform, operator as installer and auth is enabled', ctx => {
        expect(ctx.stdout).to.contain('Minikube preflight checklist')
          .and.to.contain('Running the Che Operator')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .skip()
      .stdout()
      .command(['server:stop', '--listr-renderer=verbose'])
      /*
      TODO: set CHE_ACCESS_TOKEN with auth:che-api-token that does something similar to
        CHE_USER=admin
        CHE_PASSWORD=admin
        TOKEN_ENDPOINT="http://keycloak-che.192.168.64.68.nip.io/auth/realms/che/protocol/openid-connect/token"
        export CHE_ACCESS_TOKEN=$(curl -sSL --data "grant_type=password&client_id=che-public&username=${CHE_USER}&password=${CHE_PASSWORD}" \
            ${TOKEN_ENDPOINT} | jq -r .access_token)
      */
      .exit(0)
      .it('stops Server on minikube successfully')
    test
      .skip()
      .stdout()
      .command(['server:delete', '--listr-renderer=verbose'])
      .exit(0)
      .it('deletes Che resources on minikube successfully')
  })
})
