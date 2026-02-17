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
import * as Listr from 'listr'
import {
  V1ClusterRole, V1ClusterRoleBinding,
  V1CustomResourceDefinition,
  V1Deployment,
  V1MutatingWebhookConfiguration, V1Role, V1RoleBinding, V1Service, V1ServiceAccount,
  V1ValidatingWebhookConfiguration,
} from '@kubernetes/client-node'
import {CommonTasks} from '../../common-tasks'
import {EclipseChe} from './eclipse-che'
import * as yaml from 'js-yaml'
import * as fs from 'node:fs'
import {V1Certificate} from '../../../api/types/cert-manager'
import {
  CheCtlContext,
  CliContext, EclipseCheContext,
  InfrastructureContext,
  OperatorImageUpgradeContext,
} from '../../../context'
import * as path from 'node:path'
import {KubeClient} from '../../../api/kube-client'
import {
  CHE_NAMESPACE_FLAG,
  CHE_OPERATOR_IMAGE_FLAG,
} from '../../../flags'
import {getImageNameAndTag, isPartOfEclipseChe, newListr, safeLoadFromYamlFile} from '../../../utils/utls'
import { ux } from '@oclif/core'

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

export namespace EclipseCheTasks {
  export function getCreateOrUpdateDeploymentTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('operator.yaml')
    const deployment = safeLoadFromYamlFile(yamlFilePath) as V1Deployment

    if (flags[CHE_OPERATOR_IMAGE_FLAG]) {
      const container = deployment.spec!.template.spec!.containers.find(c => c.name === `${EclipseChe.CHE_FLAVOR}-operator`)
      container!.image = flags[CHE_OPERATOR_IMAGE_FLAG]
    }

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'Deployment',
      EclipseChe.OPERATOR_DEPLOYMENT_NAME,
      () => kubeHelper.isDeploymentExist(EclipseChe.OPERATOR_DEPLOYMENT_NAME, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.createDeployment(deployment, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.replaceDeployment(EclipseChe.OPERATOR_DEPLOYMENT_NAME, deployment, flags[CHE_NAMESPACE_FLAG]))
  }

  export function getCreateOrUpdateCrdTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getCRDResourcePath()
    const crd = safeLoadFromYamlFile(yamlFilePath) as V1CustomResourceDefinition
    crd.spec.conversion!.webhook!.clientConfig!.service!.namespace = flags[CHE_NAMESPACE_FLAG]
    crd.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${flags[CHE_NAMESPACE_FLAG]}/${EclipseChe.K8S_CERTIFICATE}`

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'CRD',
      EclipseChe.CHE_CLUSTER_CRD,
      () => kubeHelper.getCustomResourceDefinition(EclipseChe.CHE_CLUSTER_CRD),
      () => kubeHelper.createCustomResourceDefinition(crd),
      () => kubeHelper.replaceCustomResourceDefinition(crd))
  }

  export function getCreateOrUpdateMutatingWebhookTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('org.eclipse.che.MutatingWebhookConfiguration.yaml')
    const webhook = safeLoadFromYamlFile(yamlFilePath) as V1MutatingWebhookConfiguration
    webhook!.webhooks![0].clientConfig.service!.namespace = flags[CHE_NAMESPACE_FLAG]
    webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${flags[CHE_NAMESPACE_FLAG]}/${EclipseChe.K8S_CERTIFICATE}`

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'MutatingWebhookConfiguration',
      EclipseChe.MUTATING_WEBHOOK,
      () => kubeHelper.isMutatingWebhookConfigurationExists(EclipseChe.MUTATING_WEBHOOK),
      () => kubeHelper.createMutatingWebhookConfiguration(webhook),
      () => kubeHelper.replaceVMutatingWebhookConfiguration(EclipseChe.MUTATING_WEBHOOK, webhook))
  }

  export function getCreateOrUpdateValidatingWebhookTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('org.eclipse.che.ValidatingWebhookConfiguration.yaml')
    const webhook = safeLoadFromYamlFile(yamlFilePath) as V1ValidatingWebhookConfiguration
    webhook!.webhooks![0].clientConfig.service!.namespace = flags[CHE_NAMESPACE_FLAG]
    webhook.metadata!.annotations!['cert-manager.io/inject-ca-from'] = `${flags[CHE_NAMESPACE_FLAG]}/${EclipseChe.K8S_CERTIFICATE}`

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'ValidatingWebhookConfiguration',
      EclipseChe.VALIDATING_WEBHOOK,
      () => kubeHelper.isValidatingWebhookConfigurationExists(EclipseChe.VALIDATING_WEBHOOK),
      () => kubeHelper.createValidatingWebhookConfiguration(webhook),
      () => kubeHelper.replaceValidatingWebhookConfiguration(EclipseChe.VALIDATING_WEBHOOK, webhook))
  }

  export function getCreateOrUpdateIssuerTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('selfsigned-issuer.yaml')
    const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString()) as any

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'Issuer',
      EclipseChe.K8S_ISSUER,
      () => kubeHelper.isIssuerExists(EclipseChe.K8S_ISSUER, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.createIssuer(issuer, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.replaceIssuer(EclipseChe.K8S_ISSUER, issuer, flags[CHE_NAMESPACE_FLAG]))
  }

  export function getCreateOrUpdateCertificateTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('serving-cert.yaml')
    const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
    certificate.spec.dnsNames = [`${EclipseChe.OPERATOR_SERVICE}.${flags[CHE_NAMESPACE_FLAG]}.svc`, `${EclipseChe.OPERATOR_SERVICE}.${flags[CHE_NAMESPACE_FLAG]}.svc.cluster.local`]

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'Certificate',
      EclipseChe.K8S_CERTIFICATE,
      () => kubeHelper.isCertificateExists(EclipseChe.K8S_CERTIFICATE, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.createCertificate(certificate, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.replaceCertificate(EclipseChe.K8S_CERTIFICATE, certificate, flags[CHE_NAMESPACE_FLAG]))
  }

  export function getCreateOrUpdateServiceAccountTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('service_account.yaml')
    const serviceAccount = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1ServiceAccount

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'ServiceAccount',
      EclipseChe.OPERATOR_SERVICE_ACCOUNT,
      () => kubeHelper.isServiceAccountExist(EclipseChe.OPERATOR_SERVICE_ACCOUNT, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.createServiceAccount(serviceAccount, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.replaceServiceAccount(EclipseChe.OPERATOR_SERVICE_ACCOUNT, serviceAccount, flags[CHE_NAMESPACE_FLAG]))
  }

  export function getCreateOrUpdateServiceTask(isCreateOnly: boolean): Listr.ListrTask<any> {
    const flags = CheCtlContext.getFlags()
    const kubeHelper = KubeClient.getInstance()

    const yamlFilePath = getResourcePath('webhook-service.yaml')
    const service = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Service

    return CommonTasks.getCreateOrUpdateResourceTask(
      isCreateOnly,
      'Service',
      EclipseChe.OPERATOR_SERVICE,
      () => kubeHelper.isServiceExists(EclipseChe.OPERATOR_SERVICE, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.createService(service, flags[CHE_NAMESPACE_FLAG]),
      () => kubeHelper.replaceService(EclipseChe.OPERATOR_SERVICE, service, flags[CHE_NAMESPACE_FLAG]))
  }

  export function getCreateOrUpdateRbacTasks(isCreateOnly: boolean): Listr.ListrTask<any> {
    return {
      title: `${isCreateOnly ? 'Create' : 'Update'} RBAC`,
      task: async (_ctx: any, _task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeClient = KubeClient.getInstance()

        const resources = collectRolesAndBindingsResources()
        const tasks = newListr()

        for (const role of resources.roles as V1Role[]) {
          const name = role.metadata!.name!
          tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
            isCreateOnly,
            'Role',
            name,
            () => kubeClient.isRoleExist(name, flags[CHE_NAMESPACE_FLAG]),
            () => kubeClient.createRole(role, flags[CHE_NAMESPACE_FLAG]),
            () => kubeClient.replaceRole(role, flags[CHE_NAMESPACE_FLAG])))
        }

        for (const roleBinding of resources.roleBindings as V1RoleBinding[]) {
          const name = roleBinding.metadata!.name!
          tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
            isCreateOnly,
            'RoleBinding',
            name,
            () => kubeClient.isRoleBindingExist(name, flags[CHE_NAMESPACE_FLAG]),
            () => kubeClient.createRoleBinding(roleBinding, flags[CHE_NAMESPACE_FLAG]),
            () => kubeClient.replaceRoleBinding(roleBinding, flags[CHE_NAMESPACE_FLAG])))
        }

        for (const clusterRole of resources.clusterRoles as V1ClusterRole[]) {
          clusterRole.metadata!.name = flags[CHE_NAMESPACE_FLAG] + '-' + clusterRole.metadata!.name!
          const name = clusterRole.metadata!.name!

          tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
            isCreateOnly,
            'RoleBinding',
            name,
            () => kubeClient.isClusterRoleExist(name),
            () => kubeClient.createClusterRole(clusterRole),
            () => kubeClient.replaceClusterRole(clusterRole)))
        }

        for (const clusterRoleBinding of resources.clusterRoleBindings as V1ClusterRoleBinding[]) {
          clusterRoleBinding.metadata!.name = flags[CHE_NAMESPACE_FLAG] + '-' + clusterRoleBinding.metadata!.name!
          clusterRoleBinding.roleRef.name = flags[CHE_NAMESPACE_FLAG] + '-' + clusterRoleBinding.roleRef.name
          for (const subj of clusterRoleBinding.subjects || []) {
            subj.namespace = flags[CHE_NAMESPACE_FLAG]
          }

          const name = clusterRoleBinding.metadata!.name!

          tasks.add(CommonTasks.getCreateOrUpdateResourceTask(
            isCreateOnly,
            'RoleBinding',
            name,
            () => kubeClient.isClusterRoleBindingExist(name),
            () => kubeClient.createClusterRoleBinding(clusterRoleBinding),
            () => kubeClient.replaceClusterRoleBinding(clusterRoleBinding)))
        }

        return tasks
      },
    }
  }

  export function getDiscoverUpgradeImagePathTask(): Listr.ListrTask<any> {
    return {
      title: `Discover ${EclipseChe.PRODUCT_NAME} upgrade path`,
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeClient = KubeClient.getInstance()

        const deployment = await kubeClient.getDeployment(EclipseChe.OPERATOR_DEPLOYMENT_NAME, flags[CHE_NAMESPACE_FLAG])
        if (!deployment) {
          throw new Error(`Deployment ${EclipseChe.OPERATOR_DEPLOYMENT_NAME} not found`)
        }

        ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE] = getContainerImage(deployment)
        const [deployedImage, deployedTag] = getImageNameAndTag(ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE])
        ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_NAME] = deployedImage
        ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_TAG] = deployedTag

        if (flags[CHE_OPERATOR_IMAGE_FLAG]) {
          ctx[OperatorImageUpgradeContext.NEW_IMAGE] = flags[CHE_OPERATOR_IMAGE_FLAG]
        } else {
          // Load new operator image from templates
          const newCheOperatorYaml = safeLoadFromYamlFile(getResourcePath('operator.yaml')) as V1Deployment
          ctx[OperatorImageUpgradeContext.NEW_IMAGE] = getContainerImage(newCheOperatorYaml)
        }

        const [newImage, newTag] = getImageNameAndTag(ctx[OperatorImageUpgradeContext.NEW_IMAGE])
        ctx[OperatorImageUpgradeContext.NEW_IMAGE_NAME] = newImage
        ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG] = newTag

        task.title = `${task.title} ${ctx[OperatorImageUpgradeContext.DEPLOYED_IMAGE_TAG]} -> ${ctx[OperatorImageUpgradeContext.NEW_IMAGE_TAG]}`
      },
    }
  }

  function getContainerImage(deployment: V1Deployment) {
    const containers = deployment.spec!.template!.spec!.containers
    const namespace = deployment.metadata!.namespace
    const name = deployment.metadata!.name
    const container = containers.find(c => c.name === EclipseChe.OPERATOR_DEPLOYMENT_NAME)

    if (!container) {
      throw new Error(`Can not evaluate image of ${namespace}/${name} deployment. Containers list are empty`)
    }

    if (!container.image) {
      throw new Error(`Container ${container.name} in deployment ${namespace}/${name} must have image specified`)
    }

    return container.image
  }

  function collectRolesAndBindingsResources(): any {
    const ctx = CheCtlContext.get()

    const resources: any = {}
    resources.roles = []
    resources.roleBindings = []
    resources.clusterRoles = []
    resources.clusterRoleBindings = []

    for (const basePath of [path.join(ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR], 'kubernetes')]) {
      if (!fs.existsSync(basePath)) {
        continue
      }

      const filesList = fs.readdirSync(basePath)
      for (const fileName of filesList) {
        if (!fileName.endsWith('.yaml')) {
          continue
        }

        const yamlContent = safeLoadFromYamlFile(path.join(basePath, fileName))
        if (!(yamlContent && yamlContent.kind)) {
          continue
        }

        switch (yamlContent.kind) {
        case 'Role':
          resources.roles.push(yamlContent)
          break
        case 'RoleBinding':
          resources.roleBindings.push(yamlContent)
          break
        case 'ClusterRole':
          resources.clusterRoles.push(yamlContent)
          break
        case 'ClusterRoleBinding':
          resources.clusterRoleBindings.push(yamlContent)
          break
        default:
          // Ignore this object kind
        }
      }
    }

    // Check consistency
    if (resources.roles.length !== resources.roleBindings.length) {
      ux.warn('Number of Roles and Role Bindings is different')
    }

    if (resources.clusterRoles.length !== resources.clusterRoleBindings.length) {
      ux.warn('Number of Cluster Roles and Cluster Role Bindings is different')
    }

    return resources
  }

  function getCRDResourcePath(): string {
    const ctx = CheCtlContext.get()
    return path.join(ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR], 'kubernetes', 'crds', 'org.eclipse.che_checlusters.yaml')
  }

  function getResourcePath(resourceName: string): string {
    const ctx = CheCtlContext.get()
    return path.join(ctx[CliContext.CLI_CHE_OPERATOR_RESOURCES_DIR], 'kubernetes', resourceName)
  }

  export async function getDeleteClusterScopeObjectsTask(): Promise<Listr.ListrTask<any>> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()
    const flags = CheCtlContext.getFlags()

    const deleteResources = [
      () => kubeHelper.deleteValidatingWebhookConfiguration(EclipseChe.VALIDATING_WEBHOOK),
      () => kubeHelper.deleteMutatingWebhookConfiguration(EclipseChe.MUTATING_WEBHOOK),
    ]

    if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
      const checluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])

      // ConsoleLink
      deleteResources.push(() => kubeHelper.deleteClusterCustomObject('console.openshift.io', 'v1', 'consolelinks', EclipseChe.CONSOLE_LINK))

      // OAuthClient
      const oAuthClientName = checluster?.spec?.networking?.auth?.oAuthClientName || `${flags[CHE_NAMESPACE_FLAG]}-client`
      deleteResources.push(() => kubeHelper.deleteClusterCustomObject('oauth.openshift.io', 'v1', 'oauthclients', oAuthClientName))

      // SCC
      const sccName = checluster?.spec?.devEnvironments?.containerBuildConfiguration?.openShiftSecurityContextConstraint || 'container-build'
      const scc = await kubeHelper.getClusterCustomObject('security.openshift.io', 'v1', 'securitycontextconstraints', sccName)
      if (scc?.metadata?.labels?.['app.kubernetes.io/managed-by'] === `${EclipseChe.CHE_FLAVOR}-operator`) {
        deleteResources.push(() => kubeHelper.deleteClusterCustomObject('security.openshift.io', 'v1', 'securitycontextconstraints', sccName))
      }
    }

    return CommonTasks.getDeleteResourcesTask('Delete cluster scope objects', deleteResources)
  }

  export function getDeleteEclipseCheResourcesTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    return CommonTasks.getDeleteResourcesTask(`Delete ${EclipseChe.CHE_CLUSTER_KIND_PLURAL}.${EclipseChe.CHE_CLUSTER_API_GROUP} resources`,
      [() => kubeHelper.deleteAllCustomResourcesAndCrd(EclipseChe.CHE_CLUSTER_CRD, EclipseChe.CHE_CLUSTER_API_GROUP, EclipseChe.CHE_CLUSTER_API_VERSION_V2, EclipseChe.CHE_CLUSTER_KIND_PLURAL)])
  }

  export function getDeleteNetworksTask(): Listr.ListrTask<any> {
    const kubeHelper = KubeClient.getInstance()
    const flags = CheCtlContext.getFlags()
    return CommonTasks.getDeleteResourcesTask('Delete Networks',
      [() => kubeHelper.deleteService(EclipseChe.OPERATOR_SERVICE, flags[CHE_NAMESPACE_FLAG])])
  }

  export async function getDeleteImageContentSourcePolicyTask(): Promise<Listr.ListrTask<any>> {
    const kubeHelper = KubeClient.getInstance()
    const imsp = await kubeHelper.getClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', EclipseChe.IMAGE_CONTENT_SOURCE_POLICY)
    return imsp && !isPartOfEclipseChe(imsp) ? CommonTasks.getSkipTask(`Delete ImageContentSourcePolicy ${EclipseChe.IMAGE_CONTENT_SOURCE_POLICY}`, `Not ${EclipseChe.PRODUCT_NAME} resource`) : CommonTasks.getDeleteResourcesTask(`Delete ImageContentSourcePolicy ${EclipseChe.IMAGE_CONTENT_SOURCE_POLICY}`,
      [() => kubeHelper.deleteClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', EclipseChe.IMAGE_CONTENT_SOURCE_POLICY)])
  }

  export async function getDeleteWorkloadsTask(): Promise<Listr.ListrTask<any>> {
    const kubeHelper = KubeClient.getInstance()
    const ctx = CheCtlContext.get()
    const flags = CheCtlContext.getFlags()

    const deleteResources = []

    let cms = await kubeHelper.listConfigMaps(flags[CHE_NAMESPACE_FLAG], 'app.kubernetes.io/part-of=che.eclipse.org,app.kubernetes.io/component=gateway-config')
    for (const cm of cms) {
      deleteResources.push(() => kubeHelper.deleteConfigMap(cm.metadata!.name!, cm.metadata!.namespace!))
    }

    if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
      deleteResources.push(() => kubeHelper.deleteSecret(EclipseChe.OPERATOR_SERVICE_CERT_SECRET, flags[CHE_NAMESPACE_FLAG]), () => kubeHelper.deleteDeployment(EclipseChe.OPERATOR_DEPLOYMENT_NAME, flags[CHE_NAMESPACE_FLAG]))

      const pods = await kubeHelper.listNamespacedPod(flags[CHE_NAMESPACE_FLAG], undefined, 'app.kubernetes.io/part-of=che.eclipse.org,app.kubernetes.io/component=che-create-tls-secret-job')
      for (const pod of pods.items) {
        deleteResources.push(() => kubeHelper.deletePod(pod.metadata!.name!, pod.metadata!.namespace!))
      }
    }

    // Delete leader election related resources
    cms = await kubeHelper.listConfigMaps(ctx[EclipseCheContext.OPERATOR_NAMESPACE])
    for (const cm of cms) {
      const configMapName = cm.metadata!.name!
      if (configMapName.endsWith('org.eclipse.che')) {
        deleteResources.push(() => kubeHelper.deleteConfigMap(configMapName, ctx[EclipseCheContext.OPERATOR_NAMESPACE]), () => kubeHelper.deleteLease(configMapName, ctx[EclipseCheContext.OPERATOR_NAMESPACE]))
      }
    }

    return CommonTasks.getDeleteResourcesTask('Delete Workloads', deleteResources)
  }

  export function getDeleteRbacTask(): Listr.ListrTask<any> {
    const kubeClient = KubeClient.getInstance()
    const ctx = CheCtlContext.get()
    const flags = CheCtlContext.getFlags()

    const deleteResources = []
    if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
      deleteResources.push(() => kubeClient.deleteRole(EclipseChe.PROMETHEUS, flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteRoleBinding(EclipseChe.PROMETHEUS, flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteClusterRole(`${EclipseChe.CHE_FLAVOR}-user-container-build`), () => kubeClient.deleteClusterRole('dev-workspace-container-build'), () => kubeClient.deleteClusterRoleBinding('dev-workspace-container-build'), () => kubeClient.deleteRoleBinding(EclipseChe.PROMETHEUS, flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteRoleBinding(`${EclipseChe.CHE_FLAVOR}-operator-service-auth-reader`, 'kube-system'))
    } else {
      deleteResources.push(() => kubeClient.deleteRole('che-operator', flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteRole('che-operator-leader-election', flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteRoleBinding('che-operator', flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteRoleBinding('che-operator-leader-election', flags[CHE_NAMESPACE_FLAG]), () => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-che-operator`), () => kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-che-operator`), () => kubeClient.deleteServiceAccount(EclipseChe.OPERATOR_SERVICE_ACCOUNT, flags[CHE_NAMESPACE_FLAG]))
    }

    deleteResources.push(() => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-che-gateway`), () => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-che-dashboard`), () => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-namespaces-clusterrole`), () => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-clusterrole`), () => kubeClient.deleteClusterRole(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-devworkspace-clusterrole`), () => kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-che-gateway`), () => kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-che-dashboard`), () => kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-namespaces-clusterrole`), () => kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-clusterrole`), () =>  kubeClient.deleteClusterRoleBinding(`${flags[CHE_NAMESPACE_FLAG]}-cheworkspaces-devworkspace-clusterrole`))

    return CommonTasks.getDeleteResourcesTask('Delete RBAC', deleteResources)
  }

  export function getDeleteCertificatesTask(): Listr.ListrTask<any> {
    const kubeClient = KubeClient.getInstance()
    const flags = CheCtlContext.getFlags()

    return CommonTasks.getDeleteResourcesTask('Delete Certificates',
      [
        () => kubeClient.deleteIssuer(EclipseChe.K8S_ISSUER, flags[CHE_NAMESPACE_FLAG]),
        () => kubeClient.deleteCertificate(EclipseChe.K8S_CERTIFICATE, flags[CHE_NAMESPACE_FLAG]),
      ])
  }

  export function getCreateImageContentSourcePolicyTask(): Listr.ListrTask<Listr.ListrContext> {
    const kubeHelper = KubeClient.getInstance()
    return CommonTasks.getCreateResourceTask(
      'ImageContentSourcePolicy',
      EclipseChe.IMAGE_CONTENT_SOURCE_POLICY,
      () => kubeHelper.getClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', EclipseChe.IMAGE_CONTENT_SOURCE_POLICY),
      () => kubeHelper.createClusterCustomObject('operator.openshift.io', 'v1alpha1', 'imagecontentsourcepolicies', constructImageContentSourcePolicy()),
    )
  }

  function constructImageContentSourcePolicy(): any {
    return {
      apiVersion: 'operator.openshift.io/v1alpha1',
      kind: 'ImageContentSourcePolicy',
      metadata: {
        name: EclipseChe.IMAGE_CONTENT_SOURCE_POLICY,
        labels: {
          'app.kubernetes.io/part-of': 'che.eclipse.org',
        },
      },
      spec: {
        repositoryDigestMirrors: [
          {
            mirrors: [
              'quay.io',
            ],
            source: 'registry.redhat.io',
          },
          {
            mirrors: [
              'quay.io',
            ],
            source: 'registry.stage.redhat.io',
          },
          {
            mirrors: [
              'quay.io',
            ],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: [
              'registry.redhat.io',
            ],
            source: 'registry.stage.redhat.io',
          },
          {
            mirrors: [
              'registry.stage.redhat.io',
            ],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: [
              'registry.redhat.io',
            ],
            source: 'registry-proxy.engineering.redhat.com',
          },
          {
            mirrors: [
              'quay.io/devfile/devworkspace-operator-bundle',
            ],
            source: 'registry.redhat.io/devworkspace/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devfile/devworkspace-operator-bundle',
            ],
            source: 'registry.stage.redhat.io/devworkspace/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devfile/devworkspace-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry.redhat.io/devworkspace/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry.stage.redhat.io/devworkspace/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'registry.redhat.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry.stage.redhat.io/devworkspace/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'registry.stage.redhat.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'registry.redhat.io/devworkspace/devworkspace-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devworkspace-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry.stage.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: [
              'quay.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
          {
            mirrors: [
              'registry.redhat.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry.stage.redhat.io/devspaces/devspaces-operator-bundle',
          },
          {
            mirrors: [
              'registry.stage.redhat.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
          {
            mirrors: [
              'registry.redhat.io/devspaces/devspaces-operator-bundle',
            ],
            source: 'registry-proxy.engineering.redhat.com/rh-osbs/devspaces-operator-bundle',
          },
        ],
      },
    }
  }
}

