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
import {CheCtlContext} from '../../../context'
import {
  CommonTasks,
} from '../../common-tasks'
import { Installer } from '../installer'
import {CertManager} from '../cert-manager-installer'
import {CHE_NAMESPACE_FLAG, DELETE_ALL_FLAG, SKIP_CERT_MANAGER_FLAG} from '../../../flags'
import {EclipseChe} from './eclipse-che'
import {PodTasks} from '../../pod-tasks'
import {CheClusterTasks} from '../../che-cluster-tasks'
import {EclipseCheTasks} from './eclipse-che-tasks'
import {newListr} from '../../../utils/utls'
import {DevWorkspaceInstallerFactory} from '../dev-workspace/dev-workspace-installer-factory'

export class EclipseCheOperatorInstaller implements Installer {
  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: `Deploy ${EclipseChe.PRODUCT_NAME} operator`,
      task: async (_ctx: any, _task: any) => {
        const tasks = newListr()
        const flags = CheCtlContext.getFlags()

        tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeployTasks())
        tasks.add(EclipseCheTasks.getCreateOrUpdateServiceAccountTask(true))
        tasks.add(EclipseCheTasks.getCreateOrUpdateRbacTasks(true))
        if (!flags[SKIP_CERT_MANAGER_FLAG]) {
          tasks.add(CertManager.getWaitCertManagerTask())
          tasks.add(CommonTasks.getWaitTask(5000))
        }

        tasks.add(EclipseCheTasks.getCreateOrUpdateCertificateTask(true))
        tasks.add(EclipseCheTasks.getCreateOrUpdateIssuerTask(true))
        tasks.add(EclipseCheTasks.getCreateOrUpdateServiceTask(true))
        tasks.add(EclipseCheTasks.getCreateOrUpdateCrdTask(true))
        tasks.add(CommonTasks.getWaitTask(5000))
        tasks.add(EclipseCheTasks.getCreateOrUpdateDeploymentTask(true))
        tasks.add(PodTasks.getPodStartTasks(EclipseChe.CHE_OPERATOR, EclipseChe.CHE_OPERATOR_SELECTOR, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(EclipseCheTasks.getCreateOrUpdateValidatingWebhookTask(true))
        tasks.add(EclipseCheTasks.getCreateOrUpdateMutatingWebhookTask(true))
        tasks.add(CheClusterTasks.getCreateEclipseCheClusterTask())
        return tasks
      },
    }
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `Update ${EclipseChe.PRODUCT_NAME} operator`,
      task: (_ctx: any, _task: any) => {
        const tasks = newListr()
        const flags = CheCtlContext.getFlags()

        tasks.add(DevWorkspaceInstallerFactory.getInstaller().getUpdateTasks())
        tasks.add(EclipseCheTasks.getCreateOrUpdateServiceAccountTask(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateRbacTasks(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateCertificateTask(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateIssuerTask(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateServiceTask(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateCrdTask(false))
        tasks.add(CommonTasks.getWaitTask(5000))
        tasks.add(EclipseCheTasks.getCreateOrUpdateDeploymentTask(false))
        tasks.add(PodTasks.getWaitLatestReplicaTask(EclipseChe.OPERATOR_DEPLOYMENT_NAME, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(EclipseCheTasks.getCreateOrUpdateValidatingWebhookTask(false))
        tasks.add(EclipseCheTasks.getCreateOrUpdateMutatingWebhookTask(false))
        tasks.add(CheClusterTasks.getPatchEclipseCheCluster())
        return tasks
      },
    }
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return {
      title: `${EclipseChe.PRODUCT_NAME} operator pre-update check`,
      task: (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const tasks = newListr()
        tasks.add(PodTasks.getDeploymentExistanceTask(EclipseChe.OPERATOR_DEPLOYMENT_NAME, flags[CHE_NAMESPACE_FLAG]))
        tasks.add(EclipseCheTasks.getDiscoverUpgradeImagePathTask())
        tasks.add(EclipseCheTasks.getCheckWorkspaceEngineCompatibilityTask())
        return tasks
      },
    }
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return {
      title: `Uninstall ${EclipseChe.PRODUCT_NAME} operator`,
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const tasks = newListr()

        if (flags[DELETE_ALL_FLAG]) {
          tasks.add(DevWorkspaceInstallerFactory.getInstaller().getDeleteTasks())
        }

        tasks.add(await EclipseCheTasks.getDeleteClusterScopeObjectsTask())
        tasks.add(EclipseCheTasks.getDeleteEclipseCheResourcesTask())
        tasks.add(EclipseCheTasks.getDeleteNetworksTask())
        tasks.add(await EclipseCheTasks.getDeleteWorkloadsTask())
        tasks.add(EclipseCheTasks.getDeleteRbacTask())
        tasks.add(EclipseCheTasks.getDeleteCertificatesTask())
        return tasks
      },
    }
  }
}
