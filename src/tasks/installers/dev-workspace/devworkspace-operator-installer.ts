/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
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
import {
  CheCtlContext,
  DevWorkspaceContext,
} from '../../../context'
import { CommonTasks } from '../../common-tasks'
import { Installer } from '../installer'
import { DevWorkspacesTasks } from './dev-workspace-tasks'
import { SKIP_DEV_WORKSPACE_FLAG } from '../../../flags'
import { DevWorkspace } from './dev-workspace'
import { newListr } from '../../../utils/utls'

/**
 * Handle setup of the dev workspace operator controller.
 */
export class DevWorkspaceOperatorInstaller implements Installer {
  protected skip: boolean

  constructor() {
    const flags = CheCtlContext.getFlags()
    this.skip = flags[SKIP_DEV_WORKSPACE_FLAG]
  }

  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Install ${DevWorkspace.PRODUCT_NAME} operator`,
      skip: () => this.skip,
      task: async (ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(CommonTasks.getCreateNamespaceTask(ctx[DevWorkspaceContext.NAMESPACE], {}))
        tasks.add(DevWorkspacesTasks.getCreateOrUpdateDevWorkspaceTask(true))
        tasks.add(DevWorkspacesTasks.getWaitDevWorkspaceTask())
        return tasks
      },
    }
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `Update ${DevWorkspace.PRODUCT_NAME} operator`,
      skip: () => this.skip,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(DevWorkspacesTasks.getCreateOrUpdateDevWorkspaceTask(false))
        tasks.add(DevWorkspacesTasks.getWaitDevWorkspaceTask())
        return tasks
      },
    }
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return {
      title: `Uninstall ${DevWorkspace.PRODUCT_NAME} operator`,
      skip: () => this.skip,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(DevWorkspacesTasks.getDeleteWebhooksTask())
        tasks.add(DevWorkspacesTasks.getDeleteCustomResourcesTasks())
        tasks.add(DevWorkspacesTasks.getDeleteServicesTask())
        tasks.add(await DevWorkspacesTasks.getDeleteWorkloadsTask())
        tasks.add(DevWorkspacesTasks.getDeleteRbacTask())
        tasks.add(DevWorkspacesTasks.getDeleteCertificatesTask())
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }
}
