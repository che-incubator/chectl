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

import {DevWorkspaceContextKeys, OLM, OLMInstallationUpdate} from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/types/olm'
import {
  DEVWORKSPACE_CSV_PREFIX,
  DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE,
  DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE,
  NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR,
  STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR,
  OPENSHIFT_OPERATORS_NAMESPACE, OPENSHIFT_MARKET_PLACE_NAMESPACE, OLM_STABLE_CHANNEL_NAME,
} from '../../constants'
import Listr = require('listr')

export class OLMDevWorkspaceTasks {
  private readonly DEV_WORKSPACE_OPERATOR_SUBSCRIPTION = 'devworkspace-operator'

  private readonly NEXT_CHANNEL = 'next'
  private readonly STABLE_CHANNEL = 'fast'

  private readonly OLM_PACKAGE_NAME = 'devworkspace-operator'
  private readonly kube: KubeHelper

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
  }

  startTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Check Dev Workspace operator installation',
        task: async (ctx: any, task: any) => {
          ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB] = await this.isDevWorkspaceOperatorInstalledViaOLM() && !await this.isCustomDevWorkspaceCatalogExists()
          task.title = `${task.title}...${ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB] ? '[OperatorHub]' : '[Not OperatorHub]'}`
        },
      },
      {
        title: 'Create Dev Workspace CatalogSource',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME] = ctx[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME ?
            STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR :
            NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR

          const catalogSourceImage = ctx[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME ?
            DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE :
            DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE

          if (!await this.kube.isCatalogSourceExists(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], OPENSHIFT_MARKET_PLACE_NAMESPACE)) {
            const catalogSource = this.constructCatalogSource(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], catalogSourceImage)
            await this.kube.createCatalogSource(catalogSource, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            await this.kube.waitCatalogSource(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], OPENSHIFT_MARKET_PLACE_NAMESPACE)
            task.title = `${task.title}...[OK]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        title: 'Create Dev Workspace operator Subscription',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          const subscription = await this.kube.getOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, OPENSHIFT_OPERATORS_NAMESPACE)
          if (!subscription) {
            const channel = ctx[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME ? this.STABLE_CHANNEL : this.NEXT_CHANNEL
            const subscription = this.constructSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], channel)
            await this.kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...[OK]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        title: 'Wait Dev Workspace operator Subscription is ready',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          const installPlan = await this.kube.waitOperatorSubscriptionReadyForApproval(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, OPENSHIFT_OPERATORS_NAMESPACE,  600)
          ctx[DevWorkspaceContextKeys.INSTALL_PLAN] = installPlan.name
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait Dev Workspace operator InstallPlan',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          await this.kube.waitOperatorInstallPlan(ctx[DevWorkspaceContextKeys.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait Dev Workspace CSV',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (_ctx: any, task: any) => {
          const installedCSVName = await this.kube.waitInstalledCSVInSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, OPENSHIFT_OPERATORS_NAMESPACE)
          const phase = await this.kube.waitCSVStatusPhase(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
          if (phase === 'Failed') {
            const csv = await this.kube.getCSV(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
            if (!csv) {
              throw new Error(`Cluster service version '${installedCSVName}' not found.`)
            }
            throw new Error(`Cluster service version resource failed for Dev Workspace operator, cause: ${csv.status.message}, reason: ${csv.status.reason}.`)
          }
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  getDeleteTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Delete Subscription ${this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, OPENSHIFT_OPERATORS_NAMESPACE)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete CSV',
        task: async (_ctx: any, task: any) => {
          try {
            const csvs = await this.kube.getCSVWithPrefix(DEVWORKSPACE_CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
            for (const csv of csvs) {
              await this.kube.deleteClusterServiceVersion(csv.metadata.name!, OPENSHIFT_OPERATORS_NAMESPACE)
            }
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete CatalogSource ${NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteCatalogSource(NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete CatalogSource ${STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteCatalogSource(STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  private constructCatalogSource(name: string, image: string): CatalogSource {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'CatalogSource',
      metadata: {
        name,
        namespace: OPENSHIFT_MARKET_PLACE_NAMESPACE,
      },
      spec: {
        image,
        sourceType: 'grpc',
        updateStrategy: {
          registryPoll: {
            interval: '15m',
          },
        },
      },
    }
  }

  private constructSubscription(name: string, source: string, channel: string): Subscription {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'Subscription',
      metadata: {
        name,
        namespace: OPENSHIFT_OPERATORS_NAMESPACE,
      },
      spec: {
        channel: channel,
        installPlanApproval: OLMInstallationUpdate.AUTO,
        name: this.OLM_PACKAGE_NAME,
        source,
        sourceNamespace: OPENSHIFT_MARKET_PLACE_NAMESPACE,
      },
    }
  }

  async isCustomDevWorkspaceCatalogExists(): Promise<boolean> {
    const IsPreInstalledOLM = await this.kube.isPreInstalledOLM()
    if (!IsPreInstalledOLM) {
      return false
    }

    const isNextCatalogExists = await this.kube.isCatalogSourceExists(STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, OPENSHIFT_OPERATORS_NAMESPACE)
    const isStableCatalogExists = await this.kube.isCatalogSourceExists(NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, OPENSHIFT_OPERATORS_NAMESPACE)

    return isNextCatalogExists || isStableCatalogExists
  }

  async isDevWorkspaceOperatorInstalledViaOLM(): Promise<Boolean> {
    const IsPreInstalledOLM = await this.kube.isPreInstalledOLM()
    if (!IsPreInstalledOLM) {
      return false
    }

    const csvs = await this.kube.getCSVWithPrefix(DEVWORKSPACE_CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
    return csvs.length > 0
  }
}
