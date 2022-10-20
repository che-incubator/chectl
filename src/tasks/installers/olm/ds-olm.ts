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
  getDeleteCatalogSourceTask,
  getDeleteSubscriptionTask,
  getFetchCheClusterCRSampleTask,
  getSetCustomOperatorImageTask,
  getSetOlmContextTask,
} from './common'
import { ChectlContext, OLM } from '../../../api/context'
import { ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME, OLM_NEXT_CHANNEL_NAME } from '../../../constants'
import { CatalogSource } from '../../../api/types/olm'

export class DevSpacesOLMInstaller implements Installer {
  private readonly IMAGE_CONTENT_SOURCE_POLICY = 'quay.io'
  private readonly kubeHelper: KubeHelper

  constructor(protected readonly flags: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  getDeployTasks(): Listr.ListrTask<any>[] {
    return [
      getSetOlmContextTask(this.flags),
      getCreatePrometheusRBACTask(this.flags),
      {
        title: `Create ImageContentSourcePolicy ${this.IMAGE_CONTENT_SOURCE_POLICY}`,
        enabled: (ctx: any) => ctx[OLM.CHANNEL] === OLM_NEXT_CHANNEL_NAME,
        task: async (_ctx: any, task: any) => {
          const imageContentSourcePolicy = await this.kubeHelper.getClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', this.IMAGE_CONTENT_SOURCE_POLICY)
          if (!imageContentSourcePolicy) {
            await this.kubeHelper.createClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', this.constructImageContentSourcePolicy())
            task.title = `${task.title}...[Ok]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      getCreateCatalogSourceTask(this.flags, this.constructCatalogSourceForNextChannel),
      getCreateSubscriptionTask(this.flags),
      getSetCustomOperatorImageTask(this.flags),
      getFetchCheClusterCRSampleTask(this.flags),
      createEclipseCheClusterTask(this.flags, this.kubeHelper),
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
      patchingEclipseCheCluster(this.flags, this.kubeHelper),
    ]
  }

  getDeleteTasks(): Listr.ListrTask<any>[] {
    return [
      getDeleteSubscriptionTask(this.flags),
      getDeleteCatalogSourceTask(this.flags),
      {
        title: `Delete ImageContentSourcePolicy ${this.IMAGE_CONTENT_SOURCE_POLICY}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kubeHelper.deleteClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', this.IMAGE_CONTENT_SOURCE_POLICY)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  constructImageContentSourcePolicy(): any {
    return {
      apiVersion: 'operator.openshift.io/v1alpha1',
      kind: 'ImageContentSourcePolicy',
      metadata: {
        name: this.IMAGE_CONTENT_SOURCE_POLICY,
        labels: {
          'app.kubernetes.io/part-of': 'che.eclipse.org',
        },
      },
      spec: {
        repositoryDigestMirrors: [
          {
            mirrors: ['quay.io'],
            source: 'registry.redhat.io',
          },
          {
            mirrors: ['quay.io'],
            source: 'registry.stage.redhat.io',
          },
          {
            mirrors: ['quay.io'],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: ['registry.redhat.io'],
            source: 'registry.stage.redhat.io',
          },
          {
            mirrors: ['registry.stage.redhat.io'],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: ['registry.redhat.io'],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: ['quay.io/devspaces/devspaces-operator-bundle'],
            source: 'registry.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: ['quay.io/devspaces/devspaces-operator-bundle'],
            source: 'registry.stage.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: ['quay.io/devspaces/devspaces-operator-bundle'],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
          {
            mirrors: ['registry.redhat.io/devspaces/devspaces-operator-bundle'],
            source: 'registry.stage.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: ['registry.stage.redhat.io/devspaces/devspaces-operator-bundle'],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
          {
            mirrors: ['registry.redhat.io/devspaces/devspaces-operator-bundle'],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
        ],
      },
    }
  }

  private constructCatalogSourceForNextChannel(): CatalogSource {
    const ctx = ChectlContext.get()
    const iibImage = `quay.io/devspaces/iib:next-v${ctx[ChectlContext.OPENSHIFT_VERSION]}-${ctx[ChectlContext.OPENSHIFT_ARCH]}`

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
        image: iibImage,
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
