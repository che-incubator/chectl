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

import { CRCTasks } from '../../../src/tasks/platforms/crc'

jest.mock('execa')

let crc = new CRCTasks()

describe('start', () => {
  fancy
    .it('confirms that CRC is running when it does run', async () => {
      const status = `CRC VM:          Running
      OpenShift:       Running (v4.x)
      Disk Usage:      9.711GB of 32.2GB (Inside the CRC VM)
      Cache Usage:     9.912GB
      Cache Directory: /Users/benoitf/.crc/cache`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await crc.isCRCRunning()
      expect(res).to.equal(true)
    })

  fancy
    .it('confirms that crc is not running when both crc and OpenShift are stopped', async () => {
      const status = `CRC VM:          Stopped
      OpenShift:       Stopped
      Disk Usage:      0B of 0B (Inside the CRC VM)
      Cache Usage:     9.912GB
      Cache Directory: /Users/benoitf/.crc/cache`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await crc.isCRCRunning()
      expect(res).to.equal(false)
    })
})
