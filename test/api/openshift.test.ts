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

import execa = require('execa')
import { expect, fancy } from 'fancy-test'

import { OpenShiftHelper } from '../../src/api/openshift'

const namespace = 'che'
const hostname = `${namespace}.192.168.64.34.nip.io`
const openshift = new OpenShiftHelper()

jest.mock('execa')

describe('OpenShift API helper', () => {
  fancy
    .it('retrieves the hostname of a route', async () => {
      (execa as any).mockResolvedValue({ exitCode: 0, stdout: hostname })
      const routeName = 'che'
      const res = await openshift.getRouteHost(routeName, namespace)
      expect(res).to.equal(hostname)
    })
})
