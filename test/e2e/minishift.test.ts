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
PROFILE=chectl-e2e-tests && \
minishift profile set ${PROFILE} && \
minishift start --memory=8GB --cpus=4 --disk-size=50g --vm-driver=xhyve  --network-nameserver 8.8.8.8 --profile ${PROFILE}

yarn test --coverage=false --testRegex=/test/e2e/minishift.test.ts

## After
minishift stop --profile ${PROFILE}
minishift delete --profile ${PROFILE}
*/

describe('e2e test', () => {
  describe('server:start without parameters', () => {
    test
      .stdout()
      .command(['server:start', '--platform=minishift', '--listr-renderer=verbose'])
      .exit(0)
      .it('uses minishift as platform, minishift-addon as installer and auth is disabled', ctx => {
        expect(ctx.stdout).to.contain('Minishift preflight checklist')
          .and.to.contain('Running the Che minishift-addon')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .stdout()
      .command(['server:stop', '--listr-renderer=verbose'])
      .exit(0)
      .it('stops Server on minishift successfully')
    test
      .stdout()
      .command(['server:delete', '--listr-renderer=verbose'])
      .exit(0)
      .it('deletes Che resources on minishift successfully')
  })
  describe('server:start mulituser', () => {
    test
      .stdout()
      .command(['server:start', '--platform=minishift', '--listr-renderer=verbose', '--multiuser'])
      .exit(0)
      .it('uses minishift as platform, operator as installer and auth is enabled', ctx => {
        expect(ctx.stdout).to.contain('Minishift preflight checklist')
          .and.to.contain('Running the Che Operator')
          .and.to.contain('Post installation checklist')
          .and.to.contain('Command server:start has completed successfully')
      })
    test
      .skip()
      .stdout()
      /*
      TODO: set CHE_ACCESS_TOKEN with auth:che-api-token that does something similar to
        CHE_USER=admin && \
        CHE_PASSWORD=admin && \
        TOKEN_ENDPOINT="http://keycloak-che.192.168.64.69.nip.io/auth/realms/che/protocol/openid-connect/token" && \
        export CHE_ACCESS_TOKEN=$(curl -sSL --data "grant_type=password&client_id=che-public&username=${CHE_USER}&password=${CHE_PASSWORD}" \
            ${TOKEN_ENDPOINT} | jq -r .access_token)
      */
      .command(['server:stop', '--listr-renderer=verbose'])
      .exit(0)
      .it('stops Server on Minishift successfully')
    test
      .skip()
      .stdout()
      .command(['server:delete', '--listr-renderer=verbose'])
      .exit(0)
      .it('deletes Che resources on Minishift successfully')
  })
})
