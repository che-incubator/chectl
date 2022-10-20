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

import { KubeHelper } from '../../../api/kube'
import { createEclipseCheClusterTask, patchingEclipseCheCluster } from '../common-tasks'
import { OLMDevWorkspaceTasks } from '../../components/devworkspace-olm-installer'
import Listr = require('listr')
import { Installer } from '../../../api/types/installer'
import {
  getApproveInstallPlanTask,
  getCheckInstallPlanApprovalStrategyTask,
  getCreateCatalogSourceTask,
  getCreatePrometheusRBACTask,
  getCreateSubscriptionTask,
  getDeleteCatalogSourceTask,
  getDeleteSubscriptionTask,
  getFetchCheClusterCRSampleTask,
  getSetCustomOperatorImageTask,
  getSetOlmContextTask,
} from './common'
import { CatalogSource } from '../../../api/types/olm'
import { ECLIPSE_CHE_NEXT_CATALOG_SOURCE_IMAGE, ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME } from '../../../constants'

export class CheOLMInstaller implements Installer {
  private readonly flags: any
  private readonly kube: KubeHelper
  private readonly olmDevWorkspaceTasks: OLMDevWorkspaceTasks

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
    this.olmDevWorkspaceTasks = new OLMDevWorkspaceTasks(flags)
    this.flags = flags
  }

  getDeployTasks(): Listr.ListrTask<any>[] {
    return [
      getSetOlmContextTask(this.flags),
      {
        title: 'Deploy Dev Workspace operator',
        task: (ctx: any, _task: any) => {
          const devWorkspaceTasks = new Listr(undefined, ctx.listrOptions)
          devWorkspaceTasks.add(this.olmDevWorkspaceTasks.startTasks())
          return devWorkspaceTasks
        },
      },
      getCreatePrometheusRBACTask(this.flags),
      getCreateCatalogSourceTask(this.flags, this.constructCatalogSourceForNextChannel),
      getCreateSubscriptionTask(this.flags),
      getSetCustomOperatorImageTask(this.flags),
      getFetchCheClusterCRSampleTask(this.flags),
      createEclipseCheClusterTask(this.flags, this.kube),
    ]
  }

  getPreUpdateTasks(): Listr.ListrTask<any>[] {
    return [
      getCheckInstallPlanApprovalStrategyTask(this.flags),
    ]
  }

  getUpdateTasks(): Listr.ListrTask<any>[] {
    return [
      getApproveInstallPlanTask(this.flags),
      patchingEclipseCheCluster(this.flags, this.kube),
    ]
  }

  getDeleteTasks(): Listr.ListrTask<any>[] {
    return [
      getDeleteSubscriptionTask(this.flags),
      getDeleteCatalogSourceTask(this.flags),
    ]
  }

  private constructCatalogSourceForNextChannel(): CatalogSource {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'CatalogSource',
      metadata: {
        name: ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME,
        labels: {
          'app.kubernetes.io/part-of': 'che.eclipse.org',
        },
      },
      spec: {
        image: ECLIPSE_CHE_NEXT_CATALOG_SOURCE_IMAGE,
        sourceType: 'grpc',
        updateStrategy: {
          registryPoll: {
            interval: '15m',
          },
        },
      },
    }
  }
}
