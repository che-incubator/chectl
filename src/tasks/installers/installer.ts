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

import { OLMTasks } from './olm'
import { OperatorTasks } from './operator'

/**
 * Tasks related to installation way.
 */
export class InstallerTasks {
  updateTasks(flags: any): Listr.ListrTask<any>[] {
    const ctx = ChectlContext.get()
    if (ctx[ChectlContext.IS_OPENSHIFT]) {
      const olmTasks = new OLMTasks(flags)
      return olmTasks.updateTasks()
    }

    const operatorTasks = new OperatorTasks(flags)
    return operatorTasks.updateTasks()
  }

  preUpdateTasks(flags: any): Listr.ListrTask<any>[] {
    const ctx = ChectlContext.get()
    if (ctx[ChectlContext.IS_OPENSHIFT]) {
      const olmTasks = new OLMTasks(flags)
      return olmTasks.preUpdateTasks()
    }

    const operatorTasks = new OperatorTasks(flags)
    return operatorTasks.preUpdateTasks()
  }

  deployTasks(flags: any): Listr.ListrTask<any>[] {
    const ctx = ChectlContext.get()
    if (ctx[ChectlContext.IS_OPENSHIFT]) {
      const olmTasks = new OLMTasks(flags)
      return olmTasks.deployTasks()
    }

    const operatorTasks = new OperatorTasks(flags)
    return operatorTasks.deployTasks()
  }
}
