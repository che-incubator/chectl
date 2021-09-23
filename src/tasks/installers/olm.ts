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
import Listr = require('listr')
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/typings/olm'
import { VersionHelper } from '../../api/version'
import { CUSTOM_CATALOG_SOURCE_NAME, CVS_PREFIX, DEFAULT_CHE_NAMESPACE, DEFAULT_CHE_OLM_PACKAGE_NAME, DEFAULT_OLM_KUBERNETES_NAMESPACE, DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, KUBERNETES_OLM_CATALOG, NEXT_CATALOG_SOURCE_NAME, OLM_NEXT_CHANNEL_NAME, OLM_STABLE_CHANNEL_NAME, OPENSHIFT_OLM_CATALOG, OPERATOR_GROUP_NAME, STABLE_ALL_NAMESPACES_CHANNEL_NAME, DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME } from '../../constants'
import { isKubernetesPlatformFamily } from '../../util'

import { createEclipseCheCluster, createNamespaceTask, patchingEclipseCheCluster } from './common-tasks'

export class OLMTasks {
  prometheusRoleName = 'prometheus-k8s'

  prometheusRoleBindingName = 'prometheus-k8s'

  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      createNamespaceTask(flags.chenamespace, this.getOlmNamespaceLabels(flags)),
      {
        enabled: () => flags['cluster-monitoring'] && flags.platform === 'openshift',
        title: `Create Role ${this.prometheusRoleName} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const yamlFilePath = path.join(flags.templates, '..', 'installers', 'prometheus-role.yaml')
          const exist = await kube.roleExist(this.prometheusRoleName, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createRoleFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
      },
      {
        enabled: () => flags['cluster-monitoring'] && flags.platform === 'openshift',
        title: `Create RoleBinding ${this.prometheusRoleBindingName} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.roleBindingExist(this.prometheusRoleBindingName, flags.chenamespace)
          const yamlFilePath = path.join(flags.templates, '..', 'installers', 'prometheus-role-binding.yaml')

          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createRoleBindingFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
      },
      {
        title: 'Create operator group',
        // 'stable-all-namespaces' channel install the operator in openshift-operators namespace and there already exists a pre-created operator-group.
        enabled: (ctx: any) => ctx.operatorNamespace !== DEFAULT_OPENSHIFT_OPERATORS_NS_NAME,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorGroup(OPERATOR_GROUP_NAME, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        },
      },
      {
        title: 'Configure context information',
        task: async (ctx: any, task: any) => {
          ctx.defaultCatalogSourceNamespace = isKubernetesPlatformFamily(flags.platform) ? DEFAULT_OLM_KUBERNETES_NAMESPACE : DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE
          // catalog source name for stable Che version
          ctx.catalogSourceNameStable = isKubernetesPlatformFamily(flags.platform) ? KUBERNETES_OLM_CATALOG : OPENSHIFT_OLM_CATALOG

          ctx.sourceName = flags['catalog-source-name'] || CUSTOM_CATALOG_SOURCE_NAME
          ctx.generalPlatformName = isKubernetesPlatformFamily(flags.platform) ? 'kubernetes' : 'openshift'

          if (flags.version) {
            // Convert version flag to channel (see subscription object), starting CSV and approval starategy
            flags.version = VersionHelper.removeVPrefix(flags.version, true)
            // Need to point to specific CSV
            ctx.startingCSV = `eclipse-che.v${flags.version}`
            // Set approval starategy to manual to prevent autoupdate to the latest version right before installation
            ctx.approvalStarategy = 'Manual'
          } else {
            ctx.startingCSV = flags['starting-csv']
            if (ctx.startingCSV) {
              // Ignore auto-update flag, otherwise it will automatically update to the latest version and starting-csv will not have any effect.
              ctx.approvalStarategy = 'Manual'
            } else if (flags['auto-update'] === undefined) {
              ctx.approvalStarategy = 'Automatic'
            } else {
              ctx.approvalStarategy = flags['auto-update'] ? 'Automatic' : 'Manual'
            }
          }

          task.title = `${task.title}...done.`
        },
      },
      {
        enabled: () => !VersionHelper.isDeployingStableVersion(flags) && !flags['catalog-source-name'] && !flags['catalog-source-yaml'] && flags['olm-channel'] !== OLM_STABLE_CHANNEL_NAME,
        title: `Create next index CatalogSource in the namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(NEXT_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            const catalogSourceImage = `quay.io/eclipse/eclipse-che-${ctx.generalPlatformName}-opm-catalog:preview`
            const nigthlyCatalogSource = this.constructIndexCatalogSource(flags.chenamespace, catalogSourceImage)
            await kube.createCatalogSource(nigthlyCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, NEXT_CATALOG_SOURCE_NAME)
          } else {
            task.title = `${task.title}...It already exists.`
          }
        },
      },
      {
        enabled: () => flags['catalog-source-yaml'],
        title: 'Create custom catalog source from file',
        task: async (ctx: any, task: any) => {
          const customCatalogSource: CatalogSource = kube.readCatalogSourceFromFile(flags['catalog-source-yaml'])
          if (!await kube.catalogSourceExists(customCatalogSource.metadata!.name!, flags.chenamespace)) {
            customCatalogSource.metadata.name = ctx.sourceName
            customCatalogSource.metadata.namespace = flags.chenamespace
            await kube.createCatalogSource(customCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, CUSTOM_CATALOG_SOURCE_NAME)
            task.title = `${task.title}...created new one, with name ${CUSTOM_CATALOG_SOURCE_NAME} in the namespace ${flags.chenamespace}.`
          } else {
            task.title = `${task.title}...It already exists.`
          }
        },
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          let subscription = await che.findCheSubscription(ctx.operatorNamespace)
          if (subscription) {
            ctx.subscriptionName = subscription.metadata.name
            task.title = `${task.title}...It already exists.`
            return
          }
          ctx.subscriptionName = DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME

          if (flags['catalog-source-yaml'] || flags['catalog-source-name']) {
            // custom Che CatalogSource
            const catalogSourceNamespace = flags['catalog-source-namespace'] || ctx.operatorNamespace
            subscription = this.constructSubscription(ctx.subscriptionName, flags['package-manifest-name'], ctx.operatorNamespace, catalogSourceNamespace, flags['olm-channel'], ctx.sourceName, ctx.approvalStarategy, ctx.startingCSV)
          } else if (VersionHelper.isDeployingStableVersion(flags) || flags['olm-channel'] === OLM_STABLE_CHANNEL_NAME) {
            // stable Che CatalogSource
            subscription = this.constructSubscription(ctx.subscriptionName, DEFAULT_CHE_OLM_PACKAGE_NAME, ctx.operatorNamespace, ctx.defaultCatalogSourceNamespace, OLM_STABLE_CHANNEL_NAME, ctx.catalogSourceNameStable, ctx.approvalStarategy, ctx.startingCSV)
          } else if (flags['olm-channel'] === STABLE_ALL_NAMESPACES_CHANNEL_NAME) {
            // stable Che CatalogSource
            subscription = this.constructSubscription(ctx.subscriptionName, DEFAULT_CHE_OLM_PACKAGE_NAME, ctx.operatorNamespace, ctx.defaultCatalogSourceNamespace, STABLE_ALL_NAMESPACES_CHANNEL_NAME, ctx.catalogSourceNameStable, ctx.approvalStarategy, ctx.startingCSV)
          } else {
            // next Che CatalogSource
            subscription = this.constructSubscription(ctx.subscriptionName, `eclipse-che-preview-${ctx.generalPlatformName}`, ctx.operatorNamespace, ctx.operatorNamespace, OLM_NEXT_CHANNEL_NAME, NEXT_CATALOG_SOURCE_NAME, ctx.approvalStarategy, ctx.startingCSV)
          }
          await kube.createOperatorSubscription(subscription)
          task.title = `${task.title}...created new one.`
        },
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(ctx.operatorNamespace, ctx.subscriptionName, 600)
          ctx.installPlanName = installPlan.name
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Approve installation',
        enabled: ctx => ctx.approvalStarategy === 'Manual',
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, ctx.operatorNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait while operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, ctx.operatorNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Set custom operator image',
        enabled: () => flags['che-operator-image'],
        task: async (_ctx: any, task: any) => {
          const csvList = await kube.getClusterServiceVersions(flags.chenamespace)
          if (csvList.items.length < 1) {
            throw new Error('Failed to get CSV for Che operator')
          }
          const csv = csvList.items[0]
          const jsonPatch = [{ op: 'replace', path: '/spec/install/spec/deployments/0/spec/template/spec/containers/0/image', value: flags['che-operator-image'] }]
          await kube.patchClusterServiceVersion(csv.metadata.namespace!, csv.metadata.name!, jsonPatch)
          task.title = `${task.title}... changed to ${flags['che-operator-image']}.`
        },
      },
      {
        title: 'Prepare Eclipse Che cluster CR',
        task: async (ctx: any, task: any) => {
          const cheCluster = await kube.getCheCluster(flags.chenamespace)
          if (cheCluster) {
            task.title = `${task.title}...It already exists..`
            return
          }

          if (!ctx.customCR) {
            ctx.defaultCR = await this.getCRFromCSV(kube, flags.chenamespace, ctx.subscriptionName)
          }

          task.title = `${task.title}...Done.`
        },
      },
      createEclipseCheCluster(flags, kube),
    ], { renderer: flags['listr-renderer'] as any })
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      {
        title: 'Check if operator group exists',
        task: async (ctx: any, task: any) => {
          if (!await kube.operatorGroupExists(OPERATOR_GROUP_NAME, ctx.operatorNamespace)) {
            command.error(`Unable to find operator group ${OPERATOR_GROUP_NAME}`)
          }
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Check if operator subscription exists',
        task: async (ctx: any, task: any) => {
          if (!await che.findCheSubscription(ctx.operatorNamespace)) {
            command.error('Unable to find operator subscription')
          }
          task.title = `${task.title}...done.`
        },
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  updateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)
    return new Listr([
      {
        title: 'Get operator installation plan',
        task: async (ctx: any, task: any) => {
          // We can be sure that the subscription exist, because it was checked in preupdate tasks
          const subscription: Subscription = (await che.findCheSubscription(ctx.operatorNamespace))!

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
                ctx.installPlanName = subscription.status.installplan.name
                task.title = `${task.title}...done.`
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
        title: 'Approve installation',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, ctx.operatorNamespace)
          task.title = `${task.title}...done.`
        },
      },
      {
        title: 'Wait while newer operator installed',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, ctx.operatorNamespace, 60)
          ctx.highlightedMessages.push(`Operator is updated from ${ctx.currentVersion} to ${ctx.nextVersion} version`)
          task.title = `${task.title}...done.`
        },
      },
      patchingEclipseCheCluster(flags, kube, command),
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)
    return [
      {
        title: 'Check if OLM is pre-installed on the platform',
        task: async (ctx: any, task: any) => {
          ctx.isPreInstalledOLM = Boolean(await kube.isPreInstalledOLM())
          task.title = `${task.title}: ${ctx.isPreInstalledOLM}...OK`
        },
      },
      {
        title: 'Check if operator is installed',
        task: async (ctx: any, task: any) => {
          const subscription = await che.findCheSubscription(flags.chenamespace)
          if (subscription) {
            ctx.subscriptionName = subscription.metadata.name
            ctx.operatorNamespace = subscription.metadata.namespace
            task.title = `${task.title}...Found ${ctx.subscriptionName}`
          }
          ctx.operatorNamespace = flags.chenamespace || DEFAULT_CHE_NAMESPACE
          task.title = `${task.title}...Not Found`
        },
      },
      {
        title: 'Delete(OLM) operator subscription',
        enabled: ctx => ctx.isPreInstalledOLM && ctx.subscriptionName,
        task: async (ctx: any, task: any) => {
          await kube.deleteOperatorSubscription(ctx.subscriptionName, ctx.operatorNamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter(csv => csv.metadata.name!.startsWith(CVS_PREFIX))
          csvsToDelete.forEach(csv => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name!))
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete(OLM) operator group ${OPERATOR_GROUP_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (ctx: any, task: any) => {
          await kube.deleteOperatorGroup(OPERATOR_GROUP_NAME, ctx.operatorNamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete(OLM) custom catalog source ${CUSTOM_CATALOG_SOURCE_NAME}`,
        task: async (ctx: any, task: any) => {
          await kube.deleteCatalogSource(ctx.operatorNamespace, CUSTOM_CATALOG_SOURCE_NAME)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete(OLM) nigthly catalog source ${NEXT_CATALOG_SOURCE_NAME}`,
        task: async (ctx: any, task: any) => {
          await kube.deleteCatalogSource(ctx.operatorNamespace, NEXT_CATALOG_SOURCE_NAME)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete role ${this.prometheusRoleName}`,
        task: async (_ctx: any, task: any) => {
          await kube.deleteRole(this.prometheusRoleName, flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
      {
        title: `Delete role binding ${this.prometheusRoleName}`,
        task: async (_ctx: any, task: any) => {
          await kube.deleteRoleBinding(this.prometheusRoleName, flags.chenamespace)
          task.title = `${task.title}...OK`
        },
      },
    ]
  }

  private isOlmPreInstalledTask(command: Command, kube: KubeHelper): Listr.ListrTask<Listr.ListrContext> {
    return {
      title: 'Check if OLM is pre-installed on the platform',
      task: async (_ctx: any, task: any) => {
        if (!await kube.isPreInstalledOLM()) {
          cli.warn('Looks like your platform hasn\'t got embedded OLM, so you should install it manually. For quick start you can use:')
          cli.url('install.sh', 'https://raw.githubusercontent.com/operator-framework/operator-lifecycle-manager/master/deploy/upstream/quickstart/install.sh')
          command.error('OLM is required for installation Eclipse Che with installer flag \'olm\'')
        }
        task.title = `${task.title}...done.`
      },
    }
  }

  private constructSubscription(name: string, packageName: string, namespace: string, sourceNamespace: string, channel: string, sourceName: string, installPlanApproval: string, startingCSV?: string): Subscription {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'Subscription',
      metadata: {
        name,
        namespace,
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

  private constructIndexCatalogSource(namespace: string, catalogSourceImage: string): CatalogSource {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'CatalogSource',
      metadata: {
        name: NEXT_CATALOG_SOURCE_NAME,
        namespace,
      },
      spec: {
        image: catalogSourceImage,
        sourceType: 'grpc',
        updateStrategy: {
          registryPoll: {
            interval: '15m',
          },
        },
      },
    }
  }

  private async getCRFromCSV(kube: KubeHelper, cheNamespace: string, subscriptionName: string): Promise<any> {
    const subscription: Subscription = await kube.getOperatorSubscription(subscriptionName, cheNamespace)
    const currentCSV = subscription.status!.currentCSV
    const csv = await kube.getCSV(currentCSV, cheNamespace)
    if (csv && csv.metadata.annotations) {
      const CRRaw = csv.metadata.annotations!['alm-examples']
      return (yaml.load(CRRaw) as Array<any>).find(cr => cr.kind === 'CheCluster')
    } else {
      throw new Error(`Unable to retrieve Che cluster CR definition from CSV: ${currentCSV}`)
    }
  }

  private getOlmNamespaceLabels(flags: any): any {
    // The label values must be strings
    if (flags['cluster-monitoring'] && flags.platform === 'openshift') {
      return { 'openshift.io/cluster-monitoring': 'true' }
    }
    return {}
  }
}
