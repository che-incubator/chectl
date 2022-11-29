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
import {isCheFlavor, newListr} from '../../../utils/utls'
import {DevWorkspaceInstallerFactory} from '../dev-workspace/dev-workspace-installer-factory'
import {CHE} from '../../../constants'

export class EclipseCheOlmInstaller implements Installer {
  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Deploy ${EclipseChe.PRODUCT_NAME}`,
      task: async (ctx: any, _task: any) => {
        const tasks = newListr()
        const flags = CheCtlContext.getFlags()

        // Create a common CatalogSource (IIB) to deploy Dev Workspace operator and DevSpaces from fast channel
        if (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL) {
          tasks.add(EclipseCheTasks.getCreateImageContentSourcePolicyTask())
          tasks.add(EclipseCheTasks.getCreateIIBCatalogSourceTask())
        }

        tasks.add(await EclipseCheTasks.getInstallDevWorkspaceOperatorTask())

        if (isCheFlavor() && ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL) {
          tasks.add(EclipseCheTasks.getCreateEclipseCheCatalogSourceTask())
        }

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
        const flags = CheCtlContext.getFlags()

        const tasks = newListr()
        if (flags[DELETE_ALL_FLAG]) {
          tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeleteTasks())
        }

        tasks.add(await EclipseCheTasks.getDeleteClusterScopeObjectsTask())
        tasks.add(EclipseCheTasks.getDeleteEclipseCheResourcesTask())
        tasks.add(EclipseCheTasks.getDeleteRbacTask())
        tasks.add(await OlmTasks.getDeleteSubscriptionAndCatalogSourceTask(EclipseChe.PACKAGE_NAME, EclipseChe.CSV_PREFIX, ctx[InfrastructureContext.OPENSHIFT_OPERATOR_NAMESPACE]))
        if (!isCheFlavor() && ctx[EclipseCheContext.CHANNEL] === EclipseChe.NEXT_CHANNEL) {
          tasks.add(await EclipseCheTasks.getDeleteImageContentSourcePolicyTask())
        }
        return tasks
      },
    }
  }
}
