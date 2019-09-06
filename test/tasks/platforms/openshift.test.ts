/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import * as execa from 'execa'
import { expect, fancy } from 'fancy-test'

import { OpenshiftTasks } from '../../../src/tasks/platforms/openshift'

jest.mock('execa')

let openshift = new OpenshiftTasks()

describe('start', () => {
  fancy
    .it('confirms that openshift is running when it does run', async () => {
      const status = `In project che on server https://master.rhpds311.openshift.opentlc.com:443

      http://che-che.apps.rhpds311.openshift.opentlc.com (svc/che-host)
        deployment/che deploys eclipse/che-server:latest
          deployment #1 running for 18 hours - 1 pod

      http://keycloak-che.apps.rhpds311.openshift.opentlc.com (svc/keycloak)
        deployment/keycloak deploys registry.access.redhat.com/redhat-sso-7/sso72-openshift:1.2-8
          deployment #1 running for 18 hours - 1 pod

      svc/postgres - 172.30.187.205:5432
        deployment/postgres deploys registry.access.redhat.com/rhscl/postgresql-96-rhel7:1-25
          deployment #1 running for 18 hours - 1 pod


      3 infos identified, use 'oc status --suggest' to see details.`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await openshift.isOpenshiftRunning()
      expect(res).to.equal(true)
    })

  fancy
    .it('confirms that openshift is not running when both minishift and OpenShift are stopped', async () => {
      const status = `Error from server (Forbidden): projects.project.openshift.io "che" is forbidden: User "system:anonymous" cannot get projects.project.openshift.io in the namespace "che": no RBAC policy matched
      `;

      (execa as any).mockResolvedValue({ exitCode: 1, stdout: status })
      const res = await openshift.isOpenshiftRunning()
      expect(res).to.equal(false)
    })
})
