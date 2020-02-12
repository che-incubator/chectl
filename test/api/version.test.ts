/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { expect, fancy } from 'fancy-test'

import { VersionHelper } from '../../src/api/version'

describe('OpenShift API helper', () => {
  fancy
    .it('check minimal version: case #1', async () => {
      const check = VersionHelper.checkMinimalVersion('v2.10', 'v2.10')
      expect(check).to.true
    })
  fancy
    .it('check minimal version: case #2', async () => {
      const check = VersionHelper.checkMinimalVersion('v3.12', 'v2.10')
      expect(check).to.true
    })
  fancy
    .it('check minimal version: case #3', async () => {
      const check = VersionHelper.checkMinimalVersion('v2.11', 'v2.10')
      expect(check).to.true
    })
  fancy
    .it('check minimal version: case #4', async () => {
      const check = VersionHelper.checkMinimalVersion('v2.09', 'v2.10')
      expect(check).to.false
    })
  fancy
    .it('check minimal version: case #5', async () => {
      const check = VersionHelper.checkMinimalVersion('v2.10', 'v3.10')
      expect(check).to.false
    })
})
