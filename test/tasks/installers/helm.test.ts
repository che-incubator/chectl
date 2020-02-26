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
// tslint:disable:object-curly-spacing
import { expect, fancy } from 'fancy-test'

import { HelmTasks } from '../../../src/tasks/installers/helm'

jest.mock('execa')

let helmTasks = new HelmTasks({})
describe('Helm helper', () => {
  fancy
    .it('check get v3 version', async () => {
      const helmVersionOutput = 'v3.0.0+ge29ce2a';
      (execa as any).mockResolvedValue({ exitCode: 0, stdout: helmVersionOutput })
      const version = await helmTasks.getVersion()
      expect(version).to.equal('v3.0.0+ge29ce2a')
    })

  fancy
    .it('check get v2 version', async () => {
      const helmVersionOutput = 'Client: v2.13.0-rc.2+gb0d4c9e';
      (execa as any).mockResolvedValue({ exitCode: 0, stdout: helmVersionOutput })
      const version = await helmTasks.getVersion()
      expect(version).to.equal('v2.13.0-rc.2+gb0d4c9e')
    })
})
