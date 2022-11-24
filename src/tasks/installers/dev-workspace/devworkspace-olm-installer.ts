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

import {CheCtlContext, DevWorkspaceContext, EclipseCheContext, InfrastructureContext} from '../../../context'
import Listr = require('listr')
import {Installer} from '../installer'
import {DevWorkspacesTasks} from './dev-workspace-tasks'
import {DevWorkspace} from './dev-workspace'
import {OlmTasks} from '../../olm-tasks'
import {SKIP_DEV_WORKSPACE_FLAG} from '../../../flags'
import {CommonTasks} from '../../common-tasks'
import {newListr} from '../../../utils/utls'

export class DevWorkspaceOlmInstaller implements Installer  {
  protected skip: boolean

  constructor() {
    const flags = CheCtlContext.get()
    this.skip = flags[SKIP_DEV_WORKSPACE_FLAG]
  }

  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Install ${DevWorkspace.PRODUCT_NAME} operator`,
      skip: () => this.skip,
      task: async (ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(OlmTasks.getCreateCatalogSourceTask(
          ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME],
          ctx[InfrastructureContext.OPENSHIFT_MARKETPLACE_NAMESPACE],
          ctx[DevWorkspaceContext.CATALOG_SOURCE_IMAGE]))

        tasks.add(OlmTasks.getCreateSubscriptionTask(
          DevWorkspace.SUBSCRIPTION,
          ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE],
          ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME],
          ctx[InfrastructureContext.OPENSHIFT_MARKETPLACE_NAMESPACE],
          DevWorkspace.PACKAGE,
          ctx[DevWorkspaceContext.CHANNEL],
          ctx[EclipseCheContext.APPROVAL_STRATEGY]
        ))

        tasks.add(DevWorkspacesTasks.getWaitDevWorkspaceTask())
        return tasks
      },
    }
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return {
      title: `Uninstall ${DevWorkspace.PRODUCT_NAME} operator`,
      task: async (ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(DevWorkspacesTasks.getDeleteWebhooksTask())
        tasks.add(DevWorkspacesTasks.getDeleteCustomResourcesTasks())
        tasks.add(DevWorkspacesTasks.getDeleteServicesTask())
        tasks.add(DevWorkspacesTasks.getDeleteWorkloadsTask())
        tasks.add(DevWorkspacesTasks.getDeleteRbacTask())

        tasks.add(OlmTasks.getDeleteSubscriptionTask(
          DevWorkspace.SUBSCRIPTION,
          ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE],
          DevWorkspace.CSV_PREFIX))

        tasks.add(OlmTasks.getDeleteCatalogSourceTask(
          ctx[DevWorkspaceContext.CATALOG_SOURCE_NAME],
          ctx[InfrastructureContext.OPENSHIFT_MARKETPLACE_NAMESPACE]))
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }
}
