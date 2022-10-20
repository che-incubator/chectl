/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import {
  CSV_PREFIX,
  DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME,
  DEFAULT_CUSTOM_CATALOG_SOURCE_NAME,
  ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME,
  ECLIPSE_CHE_NEXT_CHANNEL_PACKAGE_NAME,
  ECLIPSE_CHE_STABLE_CHANNEL_CATALOG_SOURCE_NAME,
  ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME,
  OLM_NEXT_CHANNEL_NAME,
  OLM_STABLE_CHANNEL_NAME,
  OPENSHIFT_MARKET_PLACE_NAMESPACE,
  OPENSHIFT_OPERATORS_NAMESPACE,
} from '../../../constants'
import { ChectlContext, OLM, OLMInstallationUpdate } from '../../../api/context'
import * as Listr from 'listr'
import { CheHelper } from '../../../api/che'
import { KubeHelper } from '../../../api/kube'
import { VersionHelper } from '../../../api/version'
import { getEmbeddedTemplatesDirectory, isCheClusterAPIV2 } from '../../../util'
import * as path from 'path'
import { V1Role, V1RoleBinding } from '@kubernetes/client-node'
import { CatalogSource, Subscription } from '../../../api/types/olm'
import { merge } from 'lodash'
import * as yaml from 'js-yaml'

const PROMETHEUS = 'prometheus-k8s'

export function getSetOlmContextTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  return {
    title: 'Set context',
    task: async (ctx: any, task: any) => {
      ctx[OLM.STARTING_CSV] = flags[OLM.STARTING_CSV]
      ctx[OLM.CATALOG_SOURCE_NAMESPACE] = flags[OLM.CATALOG_SOURCE_NAMESPACE] || OPENSHIFT_MARKET_PLACE_NAMESPACE

      if (flags[OLM.STARTING_CSV]) {
        // Ignore auto-update flag, otherwise it will automatically update to the latest version and 'starting-csv' will not have any effect.
        ctx[OLM.APPROVAL_STRATEGY] = OLMInstallationUpdate.MANUAL
      } else {
        ctx[OLM.APPROVAL_STRATEGY] = flags[OLM.AUTO_UPDATE] ? OLMInstallationUpdate.AUTO : OLMInstallationUpdate.MANUAL
      }

      ctx[OLM.CHANNEL] = flags[OLM.CHANNEL]
      if (!ctx[OLM.CHANNEL]) {
        if (VersionHelper.isDeployingStableVersion(flags)) {
          ctx[OLM.CHANNEL] = OLM_STABLE_CHANNEL_NAME
        } else {
          ctx[OLM.CHANNEL] = OLM_NEXT_CHANNEL_NAME
        }
      }

      ctx[OLM.PACKAGE_MANIFEST_NAME] = flags[OLM.PACKAGE_MANIFEST_NAME]
      if (!ctx[OLM.PACKAGE_MANIFEST_NAME]) {
        if (ctx[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME) {
          ctx[OLM.PACKAGE_MANIFEST_NAME] = ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME
        } else {
          ctx[OLM.PACKAGE_MANIFEST_NAME] = ECLIPSE_CHE_NEXT_CHANNEL_PACKAGE_NAME
        }
      }

      ctx[OLM.CATALOG_SOURCE_NAME] = flags[OLM.CATALOG_SOURCE_NAME]
      if (!ctx[OLM.CATALOG_SOURCE_NAME]) {
        if (ctx[OLM.CHANNEL] === OLM_STABLE_CHANNEL_NAME) {
          ctx[OLM.CATALOG_SOURCE_NAME] = ECLIPSE_CHE_STABLE_CHANNEL_CATALOG_SOURCE_NAME
        } else {
          ctx[OLM.CATALOG_SOURCE_NAME] = ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME
        }
      }

      task.title = `${task.title}...[OK]`
    },
  }
}

export function getCreatePrometheusRBACTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)

  return {
    enabled: () => flags['cluster-monitoring'],
    title: `Create Role and RoleBinding ${PROMETHEUS}`,
    task: async (_ctx: any, task: any) => {
      if (!await kubeHelper.isRoleExist(PROMETHEUS, flags.chenamespace)) {
        const yamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role.yaml')
        const role = kubeHelper.safeLoadFromYamlFile(yamlFilePath) as V1Role
        await kubeHelper.createRole(role, flags.chenamespace)
      }

      if (!await kubeHelper.isRoleBindingExist(PROMETHEUS, flags.chenamespace)) {
        const yamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role-binding.yaml')
        const roleBinding = kubeHelper.safeLoadFromYamlFile(yamlFilePath) as V1RoleBinding
        await kubeHelper.createRoleBinding(roleBinding, flags.chenamespace)
      }

      task.title = `${task.title}...[OK]`
    },
  }
}

export function getCreateCatalogSourceTask(flags: any, constructCatalogSourceForNextChannel: () => any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Create CatalogSource',
    task: async (ctx: any, task: any) => {
      let catalogSource: CatalogSource | undefined

      if (flags[OLM.CATALOG_SOURCE_YAML]) {
        catalogSource = kubeHelper.readCatalogSourceFromFile(flags[OLM.CATALOG_SOURCE_YAML])
        merge(catalogSource.metadata, { labels: { 'app.kubernetes.io/part-of': 'che.eclipse.org' } })
      } else if (ctx[OLM.CHANNEL] === OLM_NEXT_CHANNEL_NAME && !flags[OLM.CATALOG_SOURCE_NAME]) {
        catalogSource = constructCatalogSourceForNextChannel()
      } else {
        task.skip()
      }

      if (catalogSource) {
        // Move CatalogSource to `openshift-marketplace` namespace
        ctx[OLM.CATALOG_SOURCE_NAMESPACE] = OPENSHIFT_MARKET_PLACE_NAMESPACE
        ctx[OLM.CATALOG_SOURCE_NAME] = catalogSource.metadata.name

        if (!await kubeHelper.isCatalogSourceExists(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])) {
          await kubeHelper.createCatalogSource(catalogSource, ctx[OLM.CATALOG_SOURCE_NAMESPACE])
          await kubeHelper.waitCatalogSource(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])
          task.title = `${task.title}...[OK: ${ctx[OLM.CATALOG_SOURCE_NAME]}]`
        } else {
          task.title = `${task.title}...[Exists]`
        }
      }
    },
  }
}

export function getCreateSubscriptionTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)
  const cheHelper = new CheHelper(flags)

  return {
    title: `Create Subscription ${DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME}`,
    task: async (ctx: any, task: any) => {
      let subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      if (subscription) {
        ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION] = subscription.metadata.name
      } else {
        ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION] = DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME
        subscription = constructSubscription(
          ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION],
          ctx[OLM.PACKAGE_MANIFEST_NAME],
          OPENSHIFT_OPERATORS_NAMESPACE,
          ctx[OLM.CATALOG_SOURCE_NAMESPACE],
          ctx[OLM.CHANNEL],
          ctx[OLM.CATALOG_SOURCE_NAME],
          ctx[OLM.APPROVAL_STRATEGY],
          ctx[OLM.STARTING_CSV])
        await kubeHelper.createOperatorSubscription(subscription)
      }

      // wait for Subscription
      const installPlan = await kubeHelper.waitOperatorSubscriptionReadyForApproval(ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION], OPENSHIFT_OPERATORS_NAMESPACE, 600)
      ctx[OLM.INSTALL_PLAN] = installPlan.name

      // approve InstallPlan
      await kubeHelper.approveOperatorInstallationPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
      await kubeHelper.waitOperatorInstallPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)

      // wait for CSV
      const installedCSVName = await kubeHelper.waitInstalledCSVInSubscription(ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION], OPENSHIFT_OPERATORS_NAMESPACE)
      const phase = await kubeHelper.waitCSVStatusPhase(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
      if (phase === 'Failed') {
        const csv = await kubeHelper.getCSV(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
        if (!csv) {
          throw new Error(`Cluster service version '${installedCSVName}' not found.`)
        }
        throw new Error(`Cluster service version resource failed, cause: ${csv.status.message}, reason: ${csv.status.reason}.`)
      }

      task.title = `${task.title}...[OK]`
    },
  }
}

export function getSetCustomOperatorImageTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Set custom operator image',
    enabled: () => flags['che-operator-image'],
    task: async (ctx: any, task: any) => {
      const csvs = await kubeHelper.getCSVWithPrefix(CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
      if (csvs.length !== 1) {
        throw new Error('Eclipse Che operator CSV not found.')
      }
      const jsonPatch = [{ op: 'replace', path: '/spec/install/spec/deployments/0/spec/template/spec/containers/0/image', value: flags['che-operator-image'] }]
      await kubeHelper.patchClusterServiceVersion(csvs[0].metadata.name!, csvs[0].metadata.namespace!, jsonPatch)
      task.title = `${task.title}...[OK]`
    },
  }
}

export function getFetchCheClusterCRSampleTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Fetch CheCluster CR sample',
    enabled: (ctx: any) => !ctx[ChectlContext.CUSTOM_CR],
    task: async (ctx: any, task: any) => {
      const subscription = await kubeHelper.getOperatorSubscription(ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION], OPENSHIFT_OPERATORS_NAMESPACE)
      if (!subscription) {
        throw new Error(`Subscription '${ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION]}' not found in namespace '${OPENSHIFT_OPERATORS_NAMESPACE}'`)
      }
      const installedCSV = subscription.status!.installedCSV!
      const csv = await kubeHelper.getCSV(installedCSV, OPENSHIFT_OPERATORS_NAMESPACE)

      if (csv && csv.metadata.annotations) {
        const CRRaw = csv.metadata.annotations!['alm-examples']
        ctx[ChectlContext.DEFAULT_CR] = (yaml.load(CRRaw) as Array<any>).find(cr => isCheClusterAPIV2(cr))
      } else {
        throw new Error(`Unable to fetch CheCluster CR sample ${!csv ? '' : 'from CSV: ' + csv.spec.displayName}`)
      }

      task.title = `${task.title}...[OK]`
    },
  }
}

export function getDeleteSubscriptionTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)
  const cheHelper = new CheHelper(flags)

  return {
    title: 'Delete Subscription',
    task: async (ctx: any, task: any) => {
      try {
        const subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
        if (subscription) {
          if (subscription.status?.installedCSV) {
            await kubeHelper.deleteClusterServiceVersion(subscription.status.installedCSV, OPENSHIFT_OPERATORS_NAMESPACE)
          }
          await kubeHelper.deleteOperatorSubscription(subscription.metadata.name!, OPENSHIFT_OPERATORS_NAMESPACE)
        }

        // clean up remaining CSV
        const csvs = await kubeHelper.getCSVWithPrefix(CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
        for (const csv of csvs) {
          await kubeHelper.deleteClusterServiceVersion(csv.metadata.name!, OPENSHIFT_OPERATORS_NAMESPACE)
        }

        task.title = `${task.title}...[Ok]`
      } catch (e: any) {
        task.title = `${task.title}...[Failed: ${e.message}]`
      }
    },
  }
}

export function getDeleteCatalogSourceTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Delete CatalogSources',
    task: async (ctx: any, task: any) => {
      try {
        await kubeHelper.deleteCatalogSource(ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME, OPENSHIFT_MARKET_PLACE_NAMESPACE)
        await kubeHelper.deleteCatalogSource(DEFAULT_CUSTOM_CATALOG_SOURCE_NAME, OPENSHIFT_MARKET_PLACE_NAMESPACE)
        const catalogSources = await kubeHelper.listCatalogSources(OPENSHIFT_MARKET_PLACE_NAMESPACE, 'app.kubernetes.io/part-of=che.eclipse.org')
        for (const catalogSource of catalogSources) {
          await kubeHelper.deleteCatalogSource(catalogSource.metadata.name!, OPENSHIFT_MARKET_PLACE_NAMESPACE)
        }
        task.title = `${task.title}...[Ok]`
      } catch (e: any) {
        task.title = `${task.title}...[Failed: ${e.message}]`
      }
    },
  }
}

export function getApproveInstallPlanTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const cheHelper = new CheHelper(flags)
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Approve InstallPlan',
    task: async (ctx: any, task: any) => {
      const subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      if (!subscription) {
        throw new Error('Eclipse Che subscription not found.')
      }

      if (subscription.status) {
        if (subscription.status.state === 'AtLatestKnown') {
          task.title = `${task.title}...[Everything is up to date. Installed the latest known '${getVersionFromCSV(subscription.status.currentCSV)}' version]`
          return
        }

        if (subscription.status.state === 'UpgradeAvailable') {
          task.title = `${task.title}...[Upgrade is already in progress]`
          return
        }

        if (subscription.status.state === 'UpgradePending') {
          const installedCSV = subscription.status.installedCSV
          const currentCSV = subscription.status.currentCSV

          if (subscription.status.installplan?.name) {
            ctx[OLM.INSTALL_PLAN] = subscription.status.installplan.name
          } else {
            throw new Error('Eclipse Che InstallPlan name is empty.')
          }

          await kubeHelper.approveOperatorInstallationPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          await kubeHelper.waitOperatorInstallPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE, 60)
          if (installedCSV) {
            ctx.highlightedMessages.push(`Eclipse Che Operator is upgraded from '${getVersionFromCSV(installedCSV)}' to '${getVersionFromCSV(currentCSV)}' version`)
          } else {
            ctx.highlightedMessages.push(`Eclipse Che '${getVersionFromCSV(currentCSV)}' version installed`)
          }
          task.title = `${task.title}...[OK]`
          return
        }

        throw new Error(`Eclipse Che Subscription in '${subscription.status.state}' state.`)
      }

      throw new Error('Eclipse Che InstallPlan not found.')
    },
  }
}

export function getCheckInstallPlanApprovalStrategyTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const cheHelper = new CheHelper(flags)

  return {
    title: 'Check InstallPlan approval strategy',
    task: async (ctx: any, task: Listr.ListrTaskWrapper<any>) => {
      const subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      if (!subscription) {
        throw new Error('Eclipse Che subscription not found.')
      }

      if (subscription.spec.installPlanApproval === OLMInstallationUpdate.AUTO) {
        task.title = `${task.title}...[${OLMInstallationUpdate.AUTO}]`
        throw new Error('Use \'chectl server:update\' command only with \'Manual\' InstallPlan approval strategy.')
      }

      task.title = `${task.title}...[${OLMInstallationUpdate.MANUAL}]`
    },
  }
}

function getVersionFromCSV(csvName: string): string {
  return csvName.substr(csvName.lastIndexOf('v') + 1)
}

function constructSubscription(
  name: string,
  packageName: string,
  namespace: string,
  sourceNamespace: string,
  channel: string,
  sourceName: string,
  installPlanApproval: string,
  startingCSV?: string): Subscription {
  return {
    apiVersion: 'operators.coreos.com/v1alpha1',
    kind: 'Subscription',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/part-of': 'che.eclipse.org',
      },
    },
    spec: {
      channel,
      installPlanApproval,
      name: packageName,
      source: sourceName,
      sourceNamespace,
      startingCSV,
    },
  }
}
