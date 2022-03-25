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

import * as execa from 'execa'
import { expect, fancy } from 'fancy-test'

import { OpenShiftHelper } from '../../../src/api/openshift'

jest.mock('execa')

let openShiftHelper = new OpenShiftHelper()

describe('start', () => {
  fancy
    .it('confirms that openshift is not running when both minishift and OpenShift are stopped', async () => {
      const status = `Error from server (Forbidden): projects.project.openshift.io "che" is forbidden: User "system:anonymous" cannot get projects.project.openshift.io in the namespace "che": no RBAC policy matched
      `;

      (execa as any).mockResolvedValue({ exitCode: 1, stdout: status })
      const res = await openShiftHelper.isOpenShiftRunning()
      expect(res).to.equal(false)
    })
})
