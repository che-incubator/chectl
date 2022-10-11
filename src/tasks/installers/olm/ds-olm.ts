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
import Listr = require('listr')
import { Installer } from '../../../api/types/installer'
import {
  getApproveInstallPlanTask,
  getCheckInstallPlanApprovalStrategyTask,
  getCreateCatalogSourceTask,
  getCreatePrometheusRBACTask,
  getCreateSubscriptionTask,
  getDeleteCatalogSourceTask, getDeletePrometheusRBACTask,
  getDeleteSubscriptionTask,
  getFetchCheClusterCRSampleTask,
  getSetCustomOperatorImageTask,
  getSetOlmContextTask,
} from './common'

export class DevSpacesOLMInstaller implements Installer {
  private readonly flags: any
  private readonly kube: KubeHelper

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
    this.flags = flags
  }

  getDeployTasks(): Listr.ListrTask<any>[] {
    return [
      getSetOlmContextTask(this.flags),
      getCreatePrometheusRBACTask(this.flags),
      getCreateCatalogSourceTask(this.flags),
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
      getDeletePrometheusRBACTask(this.flags),
    ]
  }
}
