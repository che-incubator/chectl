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
import { cli } from 'cli-ux'
import * as yaml from 'js-yaml'
import * as path from 'path'
import { CheHelper } from '../../api/che'
import {ChectlContext, OLM, OLMInstallationUpdate} from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/types/olm'
import { VersionHelper } from '../../api/version'
import {
  CHECTL_PROJECT_NAME,
  CSV_PREFIX,
  DEFAULT_CUSTOM_CATALOG_SOURCE_NAME,
  ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME,
  DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME,
  OPENSHIFT_MARKET_PLACE_NAMESPACE,
  OPENSHIFT_OPERATORS_NAMESPACE,
  ECLIPSE_CHE_NEXT_CATALOG_SOURCE_IMAGE,
  ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME,
  OLM_NEXT_CHANNEL_NAME,
  OLM_STABLE_CHANNEL_NAME,
  ECLIPSE_CHE_STABLE_CHANNEL_CATALOG_SOURCE_NAME,
  ECLIPSE_CHE_NEXT_CHANNEL_PACKAGE_NAME,
} from '../../constants'
import {getEmbeddedTemplatesDirectory, getProjectName, isCheClusterAPIV2} from '../../util'
import { createEclipseCheClusterTask, patchingEclipseCheCluster } from './common-tasks'
import { OLMDevWorkspaceTasks } from './olm-dev-workspace-operator'
import Listr = require('listr')
import { V1Role, V1RoleBinding } from '@kubernetes/client-node'
import {merge} from 'lodash'

export class OLMTasks {
  private readonly prometheusRoleName = 'prometheus-k8s'
  private readonly prometheusRoleBindingName = 'prometheus-k8s'
  private readonly kube: KubeHelper
  private readonly che: CheHelper
  private readonly olmDevWorkspaceTasks: OLMDevWorkspaceTasks

  constructor(flags: any) {
    this.kube = new KubeHelper(flags)
    this.che = new CheHelper(flags)
    this.olmDevWorkspaceTasks = new OLMDevWorkspaceTasks(flags)
  }

  startTasks(flags: any, command: Command): Listr.ListrTask<any>[] {
    return [
      this.isOlmPreInstalledTask(command),
      {
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
      },
      {
        // Deploy Dev Workspace operator community version
        enabled: () => getProjectName() === CHECTL_PROJECT_NAME,
        title: 'Deploy Dev Workspace operator',
        task: (ctx: any, _task: any) => {
          const devWorkspaceTasks = new Listr(undefined, ctx.listrOptions)
          devWorkspaceTasks.add(this.olmDevWorkspaceTasks.startTasks())
          return devWorkspaceTasks
        },
      },
      {
        enabled: () => flags['cluster-monitoring'] && flags.platform === 'openshift',
        title: `Create Role ${this.prometheusRoleName}`,
        task: async (_ctx: any, task: any) => {
          if (await this.kube.isRoleExist(this.prometheusRoleName, flags.chenamespace)) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role.yaml')
            const role = this.kube.safeLoadFromYamlFile(yamlFilePath) as V1Role
            await this.kube.createRole(role, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        enabled: () => flags['cluster-monitoring'] && flags.platform === 'openshift',
        title: `Create RoleBinding ${this.prometheusRoleBindingName}`,
        task: async (_ctx: any, task: any) => {
          if (await this.kube.isRoleBindingExist(this.prometheusRoleBindingName, flags.chenamespace)) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlFilePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'prometheus-role-binding.yaml')
            const roleBinding = this.kube.safeLoadFromYamlFile(yamlFilePath) as V1RoleBinding
            await this.kube.createRoleBinding(roleBinding, flags.chenamespace)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: `Create custom CatalogSource from ${flags[OLM.CATALOG_SOURCE_YAML]}`,
        enabled: () => flags[OLM.CATALOG_SOURCE_YAML],
        task: async (ctx: any, task: any) => {
          const customCatalogSource: CatalogSource = this.kube.readCatalogSourceFromFile(flags[OLM.CATALOG_SOURCE_YAML])

          // custom label
          merge(customCatalogSource.metadata, {labels: { 'app.kubernetes.io/part-of': 'che.eclipse.org'}})

          // Move CatalogSource to `openshift-marketplace` namespace
          ctx[OLM.CATALOG_SOURCE_NAMESPACE] = OPENSHIFT_MARKET_PLACE_NAMESPACE
          ctx[OLM.CATALOG_SOURCE_NAME] = customCatalogSource.metadata.name

          if (!await this.kube.isCatalogSourceExists(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])) {
            await this.kube.createCatalogSource(customCatalogSource, ctx[OLM.CATALOG_SOURCE_NAMESPACE])
            await this.kube.waitCatalogSource(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])
            task.title = `${task.title}...[OK: ${ctx[OLM.CATALOG_SOURCE_NAME]}]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        enabled: (ctx: any) => ctx[OLM.CHANNEL] === OLM_NEXT_CHANNEL_NAME && !flags[OLM.CATALOG_SOURCE_NAME] && !flags[OLM.CATALOG_SOURCE_YAML],
        title: 'Create CatalogSource for \'next\' channel',
        task: async (ctx: any, task: any) => {
          ctx[OLM.CATALOG_SOURCE_NAMESPACE] = OPENSHIFT_MARKET_PLACE_NAMESPACE
          ctx[OLM.CATALOG_SOURCE_NAME] = ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME

          if (!await this.kube.isCatalogSourceExists(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])) {
            const catalogSource = this.constructNextCatalogSource()
            await this.kube.createCatalogSource(catalogSource, ctx[OLM.CATALOG_SOURCE_NAMESPACE])
            await this.kube.waitCatalogSource(ctx[OLM.CATALOG_SOURCE_NAME], ctx[OLM.CATALOG_SOURCE_NAMESPACE])
            task.title = `${task.title}...[OK: ${ctx[OLM.CATALOG_SOURCE_NAME]}]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
      {
        title: `Create Subscription ${DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME}`,
        task: async (ctx: any, task: any) => {
          let subscription = await this.che.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
          if (subscription) {
            ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION] = subscription.metadata.name
            task.title = `${task.title}...[Exists: ${subscription.metadata.name}]`
            return
          }

          ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION] = DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME
          subscription = this.constructSubscription(
            ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION],
            ctx[OLM.PACKAGE_MANIFEST_NAME],
            OPENSHIFT_OPERATORS_NAMESPACE,
            ctx[OLM.CATALOG_SOURCE_NAMESPACE],
            ctx[OLM.CHANNEL],
            ctx[OLM.CATALOG_SOURCE_NAME],
            ctx[OLM.APPROVAL_STRATEGY],
            ctx[OLM.STARTING_CSV])
          await this.kube.createOperatorSubscription(subscription)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait for Subscription',
        task: async (ctx: any, task: any) => {
          const installPlan = await this.kube.waitOperatorSubscriptionReadyForApproval(ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION], OPENSHIFT_OPERATORS_NAMESPACE, 600)
          ctx[OLM.INSTALL_PLAN] = installPlan.name
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Approve InstallPlan',
        enabled: ctx => ctx[OLM.APPROVAL_STRATEGY] === OLMInstallationUpdate.MANUAL,
        task: async (ctx: any, task: any) => {
          await this.kube.approveOperatorInstallationPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          await this.kube.waitOperatorInstallPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait for ClusterServiceVersion',
        task: async (ctx: any, task: any) => {
          const installedCSVName = await this.kube.waitInstalledCSVInSubscription(ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION], OPENSHIFT_OPERATORS_NAMESPACE)
          const phase = await this.kube.waitCSVStatusPhase(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
          if (phase === 'Failed') {
            const csv = await this.kube.getCSV(installedCSVName, OPENSHIFT_OPERATORS_NAMESPACE)
            if (!csv) {
              throw new Error(`Cluster service version '${installedCSVName}' not found.`)
            }
            throw new Error(`Cluster service version resource failed, cause: ${csv.status.message}, reason: ${csv.status.reason}.`)
          }
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Set custom operator image',
        enabled: () => flags['che-operator-image'],
        task: async (ctx: any, task: any) => {
          const csvs = await this.kube.getCSVWithPrefix(CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
          if (csvs.length !== 1) {
            throw new Error('Eclipse Che operator CSV not found.')
          }
          const jsonPatch = [{ op: 'replace', path: '/spec/install/spec/deployments/0/spec/template/spec/containers/0/image', value: flags['che-operator-image'] }]
          await this.kube.patchClusterServiceVersion(csvs[0].metadata.name!, csvs[0].metadata.namespace!, jsonPatch)
          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Prepare CheCluster CR',
        task: async (ctx: any, task: any) => {
          if (!ctx[ChectlContext.CUSTOM_CR]) {
            const cheCluster = await this.kube.getCheClusterV1(flags.chenamespace)
            if (!cheCluster) {
              ctx[ChectlContext.DEFAULT_CR] = await this.getCRFromCSV(OPENSHIFT_OPERATORS_NAMESPACE, ctx[OLM.ECLIPSE_CHE_SUBSCRIPTION])
            }
          }

          task.title = `${task.title}...[OK]`
        },
      },
      createEclipseCheClusterTask(flags, this.kube),
    ]
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    return new Listr([
      this.isOlmPreInstalledTask(command),
      {
        title: 'Check InstallPlan approval strategy',
        task: async (ctx: any, task: Listr.ListrTaskWrapper<any>) => {
          const subscription = await this.che.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
          if (!subscription) {
            command.error('Unable to find Eclipse Che subscription')
          }

          if (subscription.spec.installPlanApproval === OLMInstallationUpdate.AUTO) {
            task.title = `${task.title}...[Interrupted]`
            return new Listr([
              {
                title: '[Warning] OLM itself manage operator update with installation mode \'Automatic\'.',
                task: () => { },
              },
              {
                title: '[Warning] Use \'chectl server:update\' command only with \'Manual\' installation plan approval.',
                task: () => {
                  command.exit(0)
                },
              },
            ], ctx.listrOptions)
          }

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Check CheCluster CR',
        task: async (_ctx: any, _task: any) => {
          const cheCluster = await this.kube.getCheClusterV1(flags.chenamespace)
          if (!cheCluster) {
            command.error(`Eclipse Che cluster CR was not found in the namespace '${flags.chenamespace}'`)
          }
        },
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  updateTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Find InstallPlan',
        task: async (ctx: any, task: any) => {
          const subscription = await this.che.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
          if (!subscription) {
            command.error('Unable to find Eclipse Che subscription')
          }

          if (subscription.status) {
            if (subscription.status.state === 'AtLatestKnown') {
              task.title = `Everything is up to date. Installed the latest known version '${subscription.status.currentCSV}'.`
              return
            }

            // Retrieve current and next version from the subscription status
            const installedCSV = subscription.status.installedCSV
            if (installedCSV) {
              ctx.currentVersion = installedCSV.substr(installedCSV.lastIndexOf('v') + 1)
            }
            const currentCSV = subscription.status.currentCSV
            ctx.nextVersion = currentCSV.substr(currentCSV.lastIndexOf('v') + 1)

            if (subscription.status.state === 'UpgradePending' && subscription.status!.conditions) {
              const installCondition = subscription.status.conditions.find(condition => condition.type === 'InstallPlanPending' && condition.status === 'True')
              if (installCondition) {
                ctx[OLM.INSTALL_PLAN] = subscription.status.installplan.name
                task.title = `${task.title}...[OK]`
                return
              }
            }

            if (subscription.status.state === 'UpgradeAvailable' && installedCSV === currentCSV) {
              command.error('Another update is in progress')
            }
          }
          command.error('Unable to find installation plan to update.')
        },
      },
      {
        title: 'Approve InstallPlan',
        enabled: (ctx: any) => ctx[OLM.INSTALL_PLAN],
        task: async (ctx: any, task: any) => {
          await this.kube.approveOperatorInstallationPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          await this.kube.waitOperatorInstallPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE, 60)
          ctx.highlightedMessages.push(`Operator is updated from ${ctx.currentVersion} to ${ctx.nextVersion} version`)
          task.title = `${task.title}...[OK]`
        },
      },
      patchingEclipseCheCluster(flags, this.kube),
    ], { renderer: flags['listr-renderer'] as any })
  }

  getDeleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Check if OLM is pre-installed on the platform',
        task: async (ctx: any, task: any) => {
          ctx[OLM.PRE_INSTALLED_OLM] = Boolean(await this.kube.isPreInstalledOLM())
          if (ctx[OLM.PRE_INSTALLED_OLM]) {
            task.title = `${task.title}...[Found]`
          } else {
            task.title = `${task.title}...[Not Found]`
          }
        },
      },
      {
        title: 'Delete Subscription',
        enabled: ctx => ctx[OLM.PRE_INSTALLED_OLM],
        task: async (ctx: any, task: any) => {
          try {
            const subscription = await this.che.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
            if (subscription) {
              await this.kube.deleteOperatorSubscription(subscription.metadata.name!, OPENSHIFT_OPERATORS_NAMESPACE)
            }
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: 'Delete ClusterServiceVersion',
        enabled: ctx => ctx[OLM.PRE_INSTALLED_OLM],
        task: async (ctx: any, task: any) => {
          try {
            const csvs = await this.kube.getCSVWithPrefix(CSV_PREFIX, OPENSHIFT_OPERATORS_NAMESPACE)
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
        title: 'Delete CatalogSources',
        enabled: ctx => ctx[OLM.PRE_INSTALLED_OLM],
        task: async (ctx: any, task: any) => {
          try {
            await this.kube.deleteCatalogSource(ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            await this.kube.deleteCatalogSource(DEFAULT_CUSTOM_CATALOG_SOURCE_NAME, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            const catalogSources = await this.kube.listCatalogSources(OPENSHIFT_MARKET_PLACE_NAMESPACE, 'app.kubernetes.io/part-of=che.eclipse.org')
            for (const catalogSource of catalogSources) {
              await this.kube.deleteCatalogSource(catalogSource.metadata.name!, OPENSHIFT_MARKET_PLACE_NAMESPACE)
            }
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete Role ${this.prometheusRoleName}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteRole(this.prometheusRoleName, flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
      {
        title: `Delete RoleBinding ${this.prometheusRoleName}`,
        task: async (_ctx: any, task: any) => {
          try {
            await this.kube.deleteRoleBinding(this.prometheusRoleName, flags.chenamespace)
            task.title = `${task.title}...[Ok]`
          } catch (e: any) {
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        },
      },
    ]
  }

  private isOlmPreInstalledTask(command: Command): Listr.ListrTask<Listr.ListrContext> {
    return {
      title: 'Check if OLM is pre-installed on the platform',
      task: async (_ctx: any, task: any) => {
        if (!await this.kube.isPreInstalledOLM()) {
          cli.warn('Looks like your platform hasn\'t got embedded OLM, so you should install it manually. For quick start you can use:')
          cli.url('install.sh', 'https://raw.githubusercontent.com/operator-framework/operator-lifecycle-manager/master/deploy/upstream/quickstart/install.sh')
          command.error('OLM is required for installation of Eclipse Che with installer flag \'olm\'')
        }
        task.title = `${task.title}...[OK]`
      },
    }
  }

  private constructSubscription(
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

  private constructNextCatalogSource(): CatalogSource {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'CatalogSource',
      metadata: {
        name: ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME,
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

  private async getCRFromCSV(namespace: string, subscriptionName: string): Promise<any> {
    const subscription = await this.kube.getOperatorSubscription(subscriptionName, namespace)
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found in namespace '${namespace}'`)
    }
    const installedCSV = subscription.status!.installedCSV!
    const csv = await this.kube.getCSV(installedCSV, namespace)

    if (csv && csv.metadata.annotations) {
      const CRRaw = csv.metadata.annotations!['alm-examples']
      return (yaml.load(CRRaw) as Array<any>).find(cr => isCheClusterAPIV2(cr))
    } else {
      throw new Error(`Unable to retrieve CheCluster CR ${!csv ? '' : 'from CSV: ' + csv.spec.displayName}`)
    }
  }
}
