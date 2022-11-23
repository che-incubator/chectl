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
  CheCtlContext,
  EclipseCheContext,
  InfrastructureContext,
} from '../../../context'
import {EclipseCheTasks} from './eclipse-che-tasks'
import {EclipseChe} from './eclipse-che'
import {CheClusterTasks} from '../../che-cluster-tasks'
import {OlmTasks} from '../../olm-tasks'
import {DELETE_ALL_FLAG, STARTING_CSV_FLAG} from '../../../flags'
import {newListr} from '../../../utils/utls'
import {DevWorkspaceInstallerFactory} from '../dev-workspace/dev-workspace-installer-factory'

export class EclipseCheOlmInstaller implements Installer {
  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Deploy ${EclipseChe.PRODUCT_NAME}`,
      task: (ctx: any, _task: any) => {
        const tasks = newListr()
        const flags = CheCtlContext.getFlags()

        // DevSpaces next version
        if (ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL && EclipseChe.CHE_FLAVOR !== 'che') {
          tasks.add(EclipseCheTasks.getCreateImageContentSourcePolicyTask())
          tasks.add(EclipseCheTasks.getCreateIIBCatalogSourceTask())
        }

        tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeployTasks())
        tasks.add(EclipseCheTasks.getCreateEclipseCheCatalogSourceTask())
        tasks.add(OlmTasks.getCreateSubscriptionTask(
          EclipseChe.SUBSCRIPTION,
          ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE],
          ctx[EclipseCheContext.CATALOG_SOURCE_NAME],
          ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE],
          ctx[EclipseCheContext.PACKAGE_NAME],
          ctx[EclipseCheContext.CHANNEL],
          ctx[EclipseCheContext.APPROVAL_STRATEGY],
          flags[STARTING_CSV_FLAG]
        ))
        tasks.add(OlmTasks.getCreatePrometheusRBACTask())
        tasks.add(OlmTasks.getSetCustomEclipseCheOperatorImageTask())
        tasks.add(OlmTasks.getFetchCheClusterSampleTask())
        tasks.add(CheClusterTasks.getCreateEclipseCheClusterTask())
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `${EclipseChe.PRODUCT_NAME} operator pre-update check`,
      task: (_ctx: any, _task: any) => {
        const tasks = newListr()
        tasks.add(OlmTasks.getCheckInstallPlanApprovalStrategyTask(EclipseChe.SUBSCRIPTION))
        return tasks
      },
    }
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `Update ${EclipseChe.PRODUCT_NAME} operator`,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
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
        const tasks = newListr()

        const flags = CheCtlContext.getFlags()
        if (flags[DELETE_ALL_FLAG]) {
          tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeleteTasks())
        }

        tasks.add(await EclipseCheTasks.getDeleteClusterScopeObjectsTask())
        tasks.add(EclipseCheTasks.getDeleteEclipseCheResourcesTask())
        tasks.add(EclipseCheTasks.getDeleteRbacTask())
        tasks.add(OlmTasks.getDeleteSubscriptionTask(EclipseChe.SUBSCRIPTION, ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE], EclipseChe.CSV_PREFIX))
        tasks.add(OlmTasks.getDeleteCatalogSourceTask(ctx[EclipseCheContext.CATALOG_SOURCE_NAME], ctx[EclipseCheContext.CATALOG_SOURCE_NAMESPACE]))
        if (ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL && EclipseChe.CHE_FLAVOR !== 'che') {
          tasks.add(EclipseCheTasks.getDeleteImageContentSourcePolicyTask())
        }
        return tasks
      },
    }
  }
}
