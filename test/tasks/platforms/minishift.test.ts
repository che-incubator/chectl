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

import { MinishiftTasks } from '../../../src/tasks/platforms/minishift'

jest.mock('execa')

let ms = new MinishiftTasks()

describe('start', () => {
  fancy
    .it('confirms that minishift is running when it does run', async () => {
      const status = `Minishift:  Running
Profile:    minishift
OpenShift:  Running (openshift v3.11.0+d0c29df-98)
DiskUsage:  7% of 48G (Mounted On: /mnt/vda1)
CacheUsage: 490.8 MB (used by oc binary, ISO or cached images)`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await ms.isMinishiftRunning()
      expect(res).to.equal(true)
    })

  fancy
    .it('confirms that minishift is not running when both minishift and OpenShift are stopped', async () => {
      const status = `Minishift:  Stopped
Profile:    minishift
OpenShift:  Stopped
DiskUsage:  1% of 19G (Mounted On: /mnt/vda1)
CacheUsage: 490.8 MB (used by oc binary, ISO or cached images)`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await ms.isMinishiftRunning()
      expect(res).to.equal(false)
    })

  fancy
    .it('confirms that minishift is not running when OpenShift is stopped', async () => {
      const status = `Minishift:  Running
Profile:    minishift
OpenShift:  Stopped
DiskUsage:  1% of 19G (Mounted On: /mnt/vda1)
CacheUsage: 490.8 MB (used by oc binary, ISO or cached images)`;

      (execa as any).mockResolvedValue({ exitCode: 0, stdout: status })
      const res = await ms.isMinishiftRunning()
      expect(res).to.equal(false)
    })

  fancy
    .it('confirms that minikube is not running when it doesn\'t exist', async () => {
      (execa as any).mockResolvedValue({ exitCode: 0, stdout: 'Does Not Exist' })
      const res = await ms.isMinishiftRunning()
      expect(res).to.equal(false)
    })
})
