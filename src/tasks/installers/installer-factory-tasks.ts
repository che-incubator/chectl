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

import * as Listr from 'listr'

import { ChectlContext } from '../../api/context'

import { CheOLMInstaller } from './olm/che-olm'
import { OperatorInstaller } from './operator'
import { getProjectName } from '../../util'
import { DSC_PROJECT_NAME } from '../../constants'
import { DevSpacesOLMInstaller } from './olm/ds-olm'
import { Installer } from '../../api/types/installer'

/**
 * Installer factory.
 */
export class InstallerFactoryTasks {
  getUpdateTasks(flags: any): Listr.ListrTask<any>[] {
    const installer = this.getInstaller(flags)
    return installer.getUpdateTasks()
  }

  getPreUpdateTasks(flags: any): Listr.ListrTask<any>[] {
    const installer = this.getInstaller(flags)
    return installer.getPreUpdateTasks()
  }

  getDeployTasks(flags: any): Listr.ListrTask<any>[] {
    const installer = this.getInstaller(flags)
    return installer.getDeployTasks()
  }

  public getInstaller(flags: any): Installer {
    const ctx = ChectlContext.get()
    if (ctx[ChectlContext.IS_OPENSHIFT]) {
      if (getProjectName() === DSC_PROJECT_NAME) {
        return new DevSpacesOLMInstaller(flags)
      }

      return new CheOLMInstaller(flags)
    }

    return new OperatorInstaller(flags)
  }
}
