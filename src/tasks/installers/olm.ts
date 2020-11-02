/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command'
import { cli } from 'cli-ux'
import * as yaml from 'js-yaml'
import Listr = require('listr')
import * as path from 'path'

import { KubeHelper } from '../../api/kube'
import { CatalogSource, Subscription } from '../../api/typings/olm'
import { CUSTOM_CATALOG_SOURCE_NAME, CVS_PREFIX, DEFAULT_CHE_OLM_PACKAGE_NAME, DEFAULT_OLM_KUBERNETES_NAMESPACE, DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE, KUBERNETES_OLM_CATALOG, NIGHTLY_CATALOG_SOURCE_NAME, OLM_NIGHTLY_CHANNEL_NAME, OLM_STABLE_CHANNEL_NAME, OPENSHIFT_OLM_CATALOG, OPERATOR_GROUP_NAME, SUBSCRIPTION_NAME } from '../../constants'
import { isKubernetesPlatformFamily, isStableVersion } from '../../util'

import { createEclipseCheCluster, createNamespaceTask, updateEclipseCheCluster } from './common-tasks'

export class OLMTasks {
  prometheusRoleName = 'prometheus-k8s'
  prometheusRoleBindingName = 'prometheus-k8s'
  /**
   * Returns list of tasks which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      createNamespaceTask(flags.chenamespace, this.getOlmNamespaceLabels(flags)),
      {
        enabled: () => flags.metrics && flags.platform === 'openshift',
        title: `Create Role ${this.prometheusRoleName} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const yamlFilePath = path.join(flags.templates, '..', 'installers', 'prometheus-role.yaml')
          const exist = await kube.roleExist(this.prometheusRoleName, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            const statusCode = await kube.createRoleFromFile(yamlFilePath, flags.chenamespace)
            if (statusCode === 403) {
              command.error('ERROR: It looks like you don\'t have enough privileges. You need to grant more privileges to current user or use a different user. If you are using minishift you can "oc login -u system:admin"')
            }
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        enabled: () => flags.metrics && flags.platform === 'openshift',
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
        }
      },
      {
        title: 'Create operator group',
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            await kube.createOperatorGroup(OPERATOR_GROUP_NAME, flags.chenamespace)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Configure context information',
        task: async (ctx: any, task: any) => {
          ctx.defaultCatalogSourceNamespace = isKubernetesPlatformFamily(flags.platform) ? DEFAULT_OLM_KUBERNETES_NAMESPACE : DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE
          // catalog source name for stable Che version
          ctx.catalogSourceNameStable = isKubernetesPlatformFamily(flags.platform) ? KUBERNETES_OLM_CATALOG : OPENSHIFT_OLM_CATALOG

          if (flags['auto-update'] && !isStableVersion(flags)) {
            ctx.approvalStarategy = 'Automatic'
          } else {
            ctx.approvalStarategy = flags['auto-update'] ? 'Automatic' : 'Manual'
          }

          ctx.sourceName = flags['catalog-source-name'] || CUSTOM_CATALOG_SOURCE_NAME
          ctx.generalPlatformName = isKubernetesPlatformFamily(flags.platform) ? 'kubernetes' : 'openshift'

          task.title = `${task.title}...done.`
        }
      },
      {
        enabled: () => !isStableVersion(flags),
        title: `Create nightly index CatalogSource in the namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(NIGHTLY_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            const catalogSourceImage = `quay.io/eclipse/eclipse-che-${ctx.generalPlatformName}-opm-catalog:preview`
            const nigthlyCatalogSource = this.constructIndexCatalogSource(flags.chenamespace, catalogSourceImage)
            await kube.createCatalogSource(nigthlyCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, NIGHTLY_CATALOG_SOURCE_NAME)
          } else {
            task.title = `${task.title}...It already exists.`
          }
        }
      },
      {
        enabled: () => flags['catalog-source-yaml'],
        title: 'Create custom catalog source from file',
        task: async (ctx: any, task: any) => {
          if (!await kube.catalogSourceExists(CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            const customCatalogSource: CatalogSource = kube.readCatalogSourceFromFile(flags['catalog-source-yaml'])
            customCatalogSource.metadata.name = ctx.sourceName
            customCatalogSource.metadata.namespace = flags.chenamespace
            await kube.createCatalogSource(customCatalogSource)
            await kube.waitCatalogSource(flags.chenamespace, CUSTOM_CATALOG_SOURCE_NAME)
            task.title = `${task.title}...created new one, with name ${CUSTOM_CATALOG_SOURCE_NAME} in the namespace ${flags.chenamespace}.`
          } else {
            task.title = `${task.title}...It already exists.`
          }
        }
      },
      {
        title: 'Create operator subscription',
        task: async (ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            task.title = `${task.title}...It already exists.`
          } else {
            let subscription: Subscription

            // stable Che CatalogSource
            if (isStableVersion(flags)) {
              subscription = this.constructSubscription(SUBSCRIPTION_NAME, DEFAULT_CHE_OLM_PACKAGE_NAME, flags.chenamespace, ctx.defaultCatalogSourceNamespace, OLM_STABLE_CHANNEL_NAME, ctx.catalogSourceNameStable, ctx.approvalStarategy, flags['starting-csv'])
              // custom Che CatalogSource
            } else if (flags['catalog-source-yaml'] || flags['catalog-source-name']) {
              const catalogSourceNamespace = flags['catalog-source-namespace'] || flags.chenamespace
              subscription = this.constructSubscription(SUBSCRIPTION_NAME, flags['package-manifest-name'], flags.chenamespace, catalogSourceNamespace, flags['olm-channel'], ctx.sourceName, ctx.approvalStarategy, flags['starting-csv'])
              // nightly Che CatalogSource
            } else {
              subscription = this.constructSubscription(SUBSCRIPTION_NAME, `eclipse-che-preview-${ctx.generalPlatformName}`, flags.chenamespace, flags.chenamespace, OLM_NIGHTLY_CHANNEL_NAME, NIGHTLY_CATALOG_SOURCE_NAME, ctx.approvalStarategy, flags['starting-csv'])
            }
            await kube.createOperatorSubscription(subscription)
            task.title = `${task.title}...created new one.`
          }
        }
      },
      {
        title: 'Wait while subscription is ready',
        task: async (ctx: any, task: any) => {
          const installPlan = await kube.waitOperatorSubscriptionReadyForApproval(flags.chenamespace, SUBSCRIPTION_NAME, 600)
          ctx.installPlanName = installPlan.name
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Approve installation',
        enabled: ctx => ctx.approvalStarategy === 'Manual',
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Wait while operator installed',
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Set custom operator image',
        enabled: () => !!flags['che-operator-image'],
        task: async (_ctx: any, task: any) => {
          const csvList = await kube.getClusterServiceVersions(flags.chenamespace)
          if (csvList.items.length < 1) {
            throw new Error('Failed to get CSV for Che operator')
          }
          const csv = csvList.items[0]
          const jsonPatch = [{ op: 'replace', path: '/spec/install/spec/deployments/0/spec/template/spec/containers/0/image', value: flags['che-operator-image'] }]
          await kube.patchClusterServiceVersion(csv.metadata.namespace!, csv.metadata.name!, jsonPatch)
          task.title = `${task.title}... changed to ${flags['che-operator-image']}.`
        }
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
            ctx.defaultCR = await this.getCRFromCSV(kube, flags.chenamespace)
          }

          task.title = `${task.title}...Done.`
        }
      },
      createEclipseCheCluster(flags, kube)
    ], { renderer: flags['listr-renderer'] as any })
  }

  preUpdateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      this.isOlmPreInstalledTask(command, kube),
      {
        title: 'Check if operator group exists',
        task: async (_ctx: any, task: any) => {
          if (!await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator group ${OPERATOR_GROUP_NAME}`)
          }
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Check if operator subscription exists',
        task: async (_ctx: any, task: any) => {
          if (!await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            command.error(`Unable to find operator subscription ${SUBSCRIPTION_NAME}`)
          }
          task.title = `${task.title}...done.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })
  }

  updateTasks(flags: any, command: Command): Listr {
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: 'Get operator installation plan',
        task: async (ctx: any, task: any) => {
          const subscription: Subscription = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)

          if (subscription.status) {
            if (subscription.status.state === 'AtLatestKnown') {
              task.title = `Everything is up to date. Installed the latest known version '${subscription.status.currentCSV}'.`
              return
            }

            if (subscription.status.state === 'UpgradePending' && subscription.status!.conditions) {
              const installCondition = subscription.status.conditions.find(condition => condition.type === 'InstallPlanPending' && condition.status === 'True')
              if (installCondition) {
                ctx.installPlanName = subscription.status.installplan.name
                task.title = `${task.title}...done.`
                return
              }
            }
          }
          command.error('Unable to find installation plan to update.')
        }
      },
      {
        title: 'Approve installation',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.approveOperatorInstallationPlan(ctx.installPlanName, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Wait while newer operator installed',
        enabled: (ctx: any) => ctx.installPlanName,
        task: async (ctx: any, task: any) => {
          await kube.waitUntilOperatorIsInstalled(ctx.installPlanName, flags.chenamespace, 60)
          task.title = `${task.title}...done.`
        }
      },
      updateEclipseCheCluster(flags, kube, command)
    ], { renderer: flags['listr-renderer'] as any })
  }

  deleteTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    const kube = new KubeHelper(flags)
    return [
      {
        title: 'Check if OLM is pre-installed on the platform',
        task: async (ctx: any, task: any) => {
          ctx.isPreInstalledOLM = await kube.isPreInstalledOLM() ? true : false
          task.title = `${task.title}: ${ctx.isPreInstalledOLM}...OK`
        }
      },
      {
        title: `Delete(OLM) operator subscription ${SUBSCRIPTION_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            await kube.deleteOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: 'Delete(OLM) Eclipse Che cluster service versions',
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          const csvs = await kube.getClusterServiceVersions(flags.chenamespace)
          const csvsToDelete = csvs.items.filter(csv => csv.metadata.name!.startsWith(CVS_PREFIX))
          csvsToDelete.forEach(csv => kube.deleteClusterServiceVersion(flags.chenamespace, csv.metadata.name!))
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) operator group ${OPERATOR_GROUP_NAME}`,
        enabled: ctx => ctx.isPreInstalledOLM,
        task: async (_ctx: any, task: any) => {
          if (await kube.operatorGroupExists(OPERATOR_GROUP_NAME, flags.chenamespace)) {
            await kube.deleteOperatorGroup(OPERATOR_GROUP_NAME, flags.chenamespace)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) custom catalog source ${CUSTOM_CATALOG_SOURCE_NAME}`,
        task: async (_ctx: any, task: any) => {
          if (await kube.catalogSourceExists(CUSTOM_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            await kube.deleteCatalogSource(flags.chenamespace, CUSTOM_CATALOG_SOURCE_NAME)
          }
          task.title = `${task.title}...OK`
        }
      },
      {
        title: `Delete(OLM) nigthly catalog source ${NIGHTLY_CATALOG_SOURCE_NAME}`,
        task: async (_ctx: any, task: any) => {
          if (await kube.catalogSourceExists(NIGHTLY_CATALOG_SOURCE_NAME, flags.chenamespace)) {
            await kube.deleteCatalogSource(flags.chenamespace, NIGHTLY_CATALOG_SOURCE_NAME)
          }
          task.title = `${task.title}...OK`
        }
      }
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
      }
    }
  }

  private constructSubscription(name: string, packageName: string, namespace: string, sourceNamespace: string, channel: string, sourceName: string, installPlanApproval: string, startingCSV?: string): Subscription {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'Subscription',
      metadata: {
        name,
        namespace
      },
      spec: {
        channel,
        installPlanApproval,
        name: packageName,
        source: sourceName,
        sourceNamespace,
        startingCSV,
      }
    }
  }

  private constructIndexCatalogSource(namespace: string, catalogSourceImage: string): CatalogSource {
    return {
      apiVersion: 'operators.coreos.com/v1alpha1',
      kind: 'CatalogSource',
      metadata: {
        name: NIGHTLY_CATALOG_SOURCE_NAME,
        namespace,
      },
      spec: {
        image: catalogSourceImage,
        sourceType: 'grpc',
        updateStrategy: {
          registryPoll: {
            interval: '15m'
          }
        }
      }
    }
  }

  private async getCRFromCSV(kube: KubeHelper, cheNamespace: string): Promise<any> {
    const subscription: Subscription = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, cheNamespace)
    const currentCSV = subscription.status!.currentCSV
    const csv = await kube.getCSV(currentCSV, cheNamespace)
    if (csv && csv.metadata.annotations) {
      const CRRaw = csv.metadata.annotations!['alm-examples']
      return (yaml.safeLoad(CRRaw) as Array<any>)[0]
    } else {
      throw new Error(`Unable to retrieve Che cluster CR definition from CSV: ${currentCSV}`)
    }
  }

  private getOlmNamespaceLabels(flags: any) {
    let labels = Object.create({})

    //The label values must be strings
    if (flags.metrics && flags.platform === 'openshift') {
      labels['openshift.io/cluster-monitoring'] = 'true'
    }
    return labels
  }
}
