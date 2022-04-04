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

import Command from '@oclif/command'
import { DevWorkspaceContextKeys, OLMInstallationUpdate } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/types/olm'
import { VersionHelper } from '../../api/version'
import { DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, DEVWORKSPACE_CSV_PREFIX, DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE, DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE, NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR } from '../../constants'
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

  startTasks(flags: any, _command: Command): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Check Dev Workspace operator installation',
        task: async (ctx: any, task: any) => {
          ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB] = await this.isDevWorkspaceOperatorInstalledViaOLM() && !await this.isCustomDevWorkspaceCatalogExists()
          task.title = `${task.title}...${ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB] ? '[OperatorHub]' : '[Not OperatorHub]'}`
        },
      },
      {
        title: 'Create Dev Workspace operator CatalogSource',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME] = VersionHelper.isDeployingStableVersion(flags) ? STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR : NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR
          const catalogSourceImage = VersionHelper.isDeployingStableVersion(flags) ? DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE : DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE

          if (!await this.kube.IsCatalogSourceExists(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)) {
            const catalogSource = this.constructCatalogSource(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], catalogSourceImage)
            await this.kube.createCatalogSource(catalogSource)
            await this.kube.waitCatalogSource(ctx[DevWorkspaceContextKeys.CATALOG_SOURCE_NAME], DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
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
          const subscription = await this.kube.getOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          if (!subscription) {
            const channel = VersionHelper.isDeployingStableVersion(flags) ? this.STABLE_CHANNEL : this.NEXT_CHANNEL
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
          const installPlan = await this.kube.waitOperatorSubscriptionReadyForApproval(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,  600)
          ctx[DevWorkspaceContextKeys.INSTALL_PLAN] = installPlan.name
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait Dev Workspace operator InstallPlan',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (ctx: any, task: any) => {
          await this.kube.waitOperatorInstallPlan(ctx[DevWorkspaceContextKeys.INSTALL_PLAN], DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait Dev Workspace CSV',
        enabled: ctx => !ctx[DevWorkspaceContextKeys.IS_DEV_WORKSPACE_INSTALLED_VIA_OPERATOR_HUB],
        task: async (_ctx: any, task: any) => {
          const installedCSVName = await this.kube.waitInstalledCSVInSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          const phase = await this.kube.waitCSVStatusPhase(installedCSVName, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          if (phase === 'Failed') {
            const csv = await this.kube.getCSV(installedCSVName, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
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

  deleteResourcesTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete Dev Workspace operator subscription',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace operator CSV',
        task: async (_ctx: any, task: any) => {
          try {
            const csvs = await this.kube.getCSVWithPrefix(DEVWORKSPACE_CSV_PREFIX, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            for (const csv of csvs) {
              await this.kube.deleteClusterServiceVersion(csv.metadata.name!, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            }
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace operator catalog source for \'next\' channel',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteCatalogSource(NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete Dev Workspace operator catalog source for \'stable\' channel',
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteCatalogSource(STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
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
        namespace: DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,
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
        namespace: DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,
      },
      spec: {
        channel: channel,
        installPlanApproval: OLMInstallationUpdate.AUTO,
        name: this.OLM_PACKAGE_NAME,
        source,
        sourceNamespace: DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,
      },
    }
  }

  async isCustomDevWorkspaceCatalogExists(): Promise<boolean> {
    const IsPreInstalledOLM = await this.kube.isPreInstalledOLM()
    if (!IsPreInstalledOLM) {
      return false
    }

    const isNextCatalogExists = await this.kube.IsCatalogSourceExists(STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
    const isStableCatalogExists = await this.kube.IsCatalogSourceExists(NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)

    return isNextCatalogExists || isStableCatalogExists
  }

  async isDevWorkspaceOperatorInstalledViaOLM(): Promise<Boolean> {
    const IsPreInstalledOLM = await this.kube.isPreInstalledOLM()
    if (!IsPreInstalledOLM) {
      return false
    }

    const csvs = await this.kube.getCSVWithPrefix(DEVWORKSPACE_CSV_PREFIX, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
    return csvs.length > 0
  }
}
