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
import Listr = require('listr')
import { VersionHelper } from '../../api/version'
import { KubeHelper } from '../../api/kube'
import { OLMInstallationUpdate } from '../../api/context'
import { DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, INDEX_IMG_DEV_WORKSPACE_NEXT_OPERATOR, NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, DEVWORKSPACE_CSV_PREFIX, STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR, INDEX_IMG_DEV_WORKSPACE_STABLE_OPERATOR } from '../../constants'
import { CatalogSource, Subscription } from '../../api/types/olm'

export class OLMDevWorkspaceTasks {
  private readonly DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_NEXT = 'devworkspace-operator'
  private readonly DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_STABLE = 'devworkspace-operator-stable'

  private readonly OLM_CHANNEL = 'fast'

  private readonly OLM_PACKAGE_NAME = 'devworkspace-operator'
  private readonly kube: KubeHelper

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
  }

  startTasks(flags: any, _command: Command): Listr.ListrTask<any>[] {
    return [
      {
        title: 'Check dev-workspace operator installation',
        task: async (ctx: any, task: any) => {
          const isOperatorInstalled = await this.isOperatorInstalledViaOLM()
          const isCustomCatalog = await this.isCustomDevWorkspaceCatalogExists()
          ctx.isOperatorHubInstallationPresent = isOperatorInstalled && !isCustomCatalog

          task.title = `${task.title}...${ctx.isOperatorHubInstallationPresent ? '[Exists]' : '[OK]'}`
        },
      },
      {
        title: 'Create dev-workspace operator CatalogSource',
        enabled: ctx => !ctx.isOperatorHubInstallationPresent,
        task: async (ctx: any, task: any) => {
          ctx.catalogSourceName = VersionHelper.isDeployingStableVersion(flags) ? STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR : NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR
          const catalogSourceImage = VersionHelper.isDeployingStableVersion(flags) ? INDEX_IMG_DEV_WORKSPACE_STABLE_OPERATOR : INDEX_IMG_DEV_WORKSPACE_NEXT_OPERATOR

          if (!await this.kube.IsCatalogSourceExists(ctx.catalogSourceName, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)) {
            const catalogSource = this.constructIndexCatalogSource(ctx.catalogSourceName, catalogSourceImage)
            await this.kube.createCatalogSource(catalogSource)
            await this.kube.waitCatalogSource(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, ctx.catalogSourceName)
            task.title = `${task.title}...[OK]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        title: 'Create dev-workspace operator subscription',
        enabled: ctx => !ctx.isOperatorHubInstallationPresent,
        task: async (ctx: any, task: any) => {
          ctx.subscriptionName = VersionHelper.isDeployingStableVersion(flags) ? this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_STABLE : this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_NEXT
          const subscription = await this.kube.getOperatorSubscription(ctx.subscriptionName, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          if (!subscription) {
            const subscription = this.constructSubscription(ctx.subscriptionName, ctx.catalogSourceName)
            await this.kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...[OK]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        title: 'Wait while dev-workspace subscription is ready',
        enabled: ctx => !ctx.isOperatorHubInstallationPresent,
        task: async (ctx: any, task: any) => {
          const installPlan = await this.kube.waitOperatorSubscriptionReadyForApproval(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, ctx.subscriptionName, 600)
          ctx.installPlanDevWorkspace = installPlan.name
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait dev-workspace operator install plan',
        enabled: ctx => !ctx.isOperatorHubInstallationPresent,
        task: async (ctx: any, task: any) => {
          await this.kube.waitOperatorInstallPlan(ctx.installPlanDevWorkspace, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Check dev-workspace cluster service version resource',
        enabled: ctx => !ctx.isOperatorHubInstallationPresent,
        task: async (ctx: any, task: any) => {
          const installedCSV = await this.kube.waitInstalledCSV(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, ctx.subscriptionName)
          const csv = await this.kube.getCSV(installedCSV, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          if (!csv) {
            throw new Error(`cluster service version resource ${installedCSV} not found`)
          }
          if (csv.status.phase === 'Failed') {
            throw new Error(`dev-workspace operator cluster service version resource failed. Cause: ${csv.status.message}. Reason: ${csv.status.reason}.`)
          }
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  deleteTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Delete(OLM) dev-workspace operator \'next\' subscription',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_NEXT, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Delete(OLM) dev-workspace operator \'stable\' subscription',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteOperatorSubscription(this.DEV_WORKSPACE_OPERATOR_SUBSCRIPTION_STABLE, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Delete(OLM) dev-workspace operator cluster service versions',
        task: async (_ctx: any, task: any) => {
          const csvs = await this.kube.getClusterServiceVersions(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          const csvsToDelete = csvs.items.filter(csv => csv.metadata.name!.startsWith(DEVWORKSPACE_CSV_PREFIX))
          for (const csv of csvsToDelete) {
            await this.kube.deleteClusterServiceVersion(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, csv.metadata.name!)
          }
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Delete dev-workspace operator \'next\' catalog source',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteCatalogSource(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Delete dev-workspace operator \'stable\' catalog source',
        task: async (_ctx: any, task: any) => {
          await this.kube.deleteCatalogSource(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR)
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  private constructIndexCatalogSource(name: string, image: string): CatalogSource {
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

  private constructSubscription(name: string, source: string): Subscription {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'Subscription',
      metadata: {
        name,
        namespace: DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,
      },
      spec: {
        channel: this.OLM_CHANNEL,
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

  async isOperatorInstalledViaOLM(): Promise<Boolean> {
    const IsPreInstalledOLM = await this.kube.isPreInstalledOLM()
    if (!IsPreInstalledOLM) {
      return false
    }

    const csvAll = await this.kube.getClusterServiceVersions(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
    const devWorkspaceCSVs = csvAll.items.filter(csv => csv.metadata.name!.startsWith(DEVWORKSPACE_CSV_PREFIX))
    if (devWorkspaceCSVs.length > 0) {
      return true
    }

    return false
  }
}
