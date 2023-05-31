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

import Listr = require('listr')
import { Installer } from '../installer'
import {
  CheCtlContext, EclipseCheContext,
} from '../../../context'
import {EclipseCheTasks} from './eclipse-che-tasks'
import {EclipseChe} from './eclipse-che'
import {CheClusterTasks} from '../../che-cluster-tasks'
import {OlmTasks} from '../../olm-tasks'
import {DELETE_ALL_FLAG, STARTING_CSV_FLAG} from '../../../flags'
import {isCheFlavor, newListr} from '../../../utils/utls'
import {DevWorkspaceInstallerFactory} from '../dev-workspace/dev-workspace-installer-factory'
import {CommonTasks} from '../../common-tasks'
import {DevWorkspace} from '../dev-workspace/dev-workspace'
import {Che} from '../../../utils/che'

export class EclipseCheOlmInstaller implements Installer {
  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Deploy ${EclipseChe.PRODUCT_NAME}`,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
        await this.addCommonInstallTasks(tasks)

        tasks.add(OlmTasks.getSetCustomEclipseCheOperatorImageTask())
        tasks.add(OlmTasks.getCreatePrometheusRBACTask())
        tasks.add(OlmTasks.getFetchCheClusterSampleTask())
        tasks.add(CheClusterTasks.getCreateEclipseCheClusterTask())
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `Update ${EclipseChe.PRODUCT_NAME} operator`,
      task: async (ctx: any, _task: any) => {
        const tasks = newListr()

        if (ctx[EclipseCheContext.CREATE_CATALOG_SOURCE_AND_SUBSCRIPTION]) {
          tasks.add(await OlmTasks.getDeleteSubscriptionAndCatalogSourceTask(
            DevWorkspace.PACKAGE,
            DevWorkspace.CSV_PREFIX,
            ctx[EclipseCheContext.OPERATOR_NAMESPACE]))
          tasks.add(await OlmTasks.getDeleteSubscriptionAndCatalogSourceTask(
            EclipseChe.PACKAGE,
            EclipseChe.CSV_PREFIX,
            ctx[EclipseCheContext.OPERATOR_NAMESPACE]))

          await this.addCommonInstallTasks(tasks)
        }

        tasks.add(OlmTasks.getSetCustomEclipseCheOperatorImageTask())
        tasks.add(OlmTasks.getApproveInstallPlanTask(EclipseChe.SUBSCRIPTION))
        tasks.add(CheClusterTasks.getPatchEclipseCheCluster())
        return tasks
      },
    }
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return {
      title: `Uninstall ${EclipseChe.PRODUCT_NAME} operator`,
      task: async (ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()

        const tasks = newListr()
        if (flags[DELETE_ALL_FLAG]) {
          tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeleteTasks())
        }

        tasks.add(await EclipseCheTasks.getDeleteClusterScopeObjectsTask())
        tasks.add(EclipseCheTasks.getDeleteEclipseCheResourcesTask())
        tasks.add(await OlmTasks.getDeleteSubscriptionAndCatalogSourceTask(EclipseChe.PACKAGE, EclipseChe.CSV_PREFIX, ctx[EclipseCheContext.OPERATOR_NAMESPACE]))
        tasks.add(await EclipseCheTasks.getDeleteWorkloadsTask())
        tasks.add(EclipseCheTasks.getDeleteRbacTask())
        if (!isCheFlavor()) {
          tasks.add(await EclipseCheTasks.getDeleteImageContentSourcePolicyTask())
        }
        tasks.add(OlmTasks.getDeleteOperatorsTask())
        return tasks
      },
    }
  }

  async addCommonInstallTasks(tasks: Listr): Promise<void> {
    const ctx = CheCtlContext.get()
    const flags = CheCtlContext.getFlags()

    if (!Che.isRedHatCatalogSources(ctx[EclipseCheContext.CATALOG_SOURCE_NAME])) {
      if (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] !== EclipseChe.STABLE_CHANNEL) {
        tasks.add(EclipseCheTasks.getCreateImageContentSourcePolicyTask())
      }

      tasks.add(OlmTasks.getCreateCatalogSourceTask(
        ctx[EclipseCheContext.CATALOG_SOURCE_NAME],
        ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE],
        ctx[EclipseCheContext.CATALOG_SOURCE_IMAGE]))
    }

    tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeployTasks())

    tasks.add(OlmTasks.getCreateSubscriptionTask(
      EclipseChe.SUBSCRIPTION,
      ctx[EclipseCheContext.OPERATOR_NAMESPACE],
      ctx[EclipseCheContext.CATALOG_SOURCE_NAME],
      ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE],
      ctx[EclipseCheContext.PACKAGE_NAME],
      ctx[EclipseCheContext.CHANNEL],
      ctx[EclipseCheContext.APPROVAL_STRATEGY],
      flags[STARTING_CSV_FLAG]
    ))
  }
}
