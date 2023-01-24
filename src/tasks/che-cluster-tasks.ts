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

import * as Listr from 'listr'
import {KubeClient} from '../api/kube-client'
import {isEmpty, merge} from 'lodash'
import {CheCtlContext, EclipseCheContext, InfrastructureContext} from '../context'
import {
  CHE_IMAGE_FLAG,
  CHE_NAMESPACE_FLAG,
  DEBUG_FLAG, DEVFILE_REGISTRY_URL_FLAG,
  DOMAIN_FLAG, PLATFORM_FLAG, PLUGIN_REGISTRY_URL_FLAG,
  POSTGRES_PVS_STORAGE_CLASS_NAME_FLAG, WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG,
} from '../flags'
import {cli} from 'cli-ux'
import {EclipseChe} from './installers/eclipse-che/eclipse-che'
import {CheCluster} from '../api/types/che-cluster'

export namespace CheClusterTasks {
  export function getPatchEclipseCheCluster(): Listr.ListrTask<any> {
    return {
      title: 'Patch CheCluster Custom Resource',
      enabled: (ctx: any) => !isEmpty(ctx[EclipseCheContext.CR_PATCH]),
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
        if (!cheCluster) {
          cli.error(`${EclipseChe.PRODUCT_NAME} cluster Custom Object not found in the namespace '${flags[CHE_NAMESPACE_FLAG]}'`)
        }

        await kubeHelper.patchNamespacedCustomObject(
          cheCluster.metadata.name!,
          flags[CHE_NAMESPACE_FLAG],
          ctx[EclipseCheContext.CR_PATCH],
          EclipseChe.CHE_CLUSTER_API_GROUP,
          EclipseChe.CHE_CLUSTER_API_VERSION_V2,
          EclipseChe.CHE_CLUSTER_KIND_PLURAL)

        task.title = `${task.title}...[Patched]`
      },
    }
  }

  export function getCreateEclipseCheClusterTask(): Listr.ListrTask<any> {
    return {
      title: 'Create CheCluster Custom Resource',
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        let cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
        if (cheCluster) {
          task.title = `${task.title}...[Exists]`
          return
        }

        cheCluster = (ctx[EclipseCheContext.CUSTOM_CR] || ctx[EclipseCheContext.DEFAULT_CR]) as CheCluster

        // merge flags
        merge(cheCluster, { spec: { components: { cheServer: { debug: flags[DEBUG_FLAG]} } } })

        if (flags[CHE_IMAGE_FLAG]) {
          merge(cheCluster, { spec: { components: { cheServer: { deployment: { containers: [{ image: flags[CHE_IMAGE_FLAG] }] } } } } })
        }

        if (!ctx[InfrastructureContext.IS_OPENSHIFT]) {
          if (!cheCluster.spec?.networking?.tlsSecretName) {
            merge(cheCluster, { spec: { networking: { tlsSecretName: EclipseChe.CHE_TLS_SECRET_NAME } } })
          }
          if (flags[DOMAIN_FLAG]) {
            merge(cheCluster, { spec: { networking: { domain: flags[DOMAIN_FLAG] } } })
          }
        }

        if (flags[POSTGRES_PVS_STORAGE_CLASS_NAME_FLAG]) {
          merge(cheCluster, { spec: { components: { database: { pvc: { storageClass: flags[POSTGRES_PVS_STORAGE_CLASS_NAME_FLAG] } } } } })
        }

        if (flags[WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG]) {
          merge(cheCluster, { spec: { workspaces: { storage: { pvc: { storageClass: flags[WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG] } } } } })
        }

        if (flags[PLUGIN_REGISTRY_URL_FLAG]) {
          merge(cheCluster, { spec: { components: { pluginRegistry: { disableInternalRegistry: true, externalPluginRegistries: [{ url: flags[PLUGIN_REGISTRY_URL_FLAG] }] } } } })
        }

        if (flags[DEVFILE_REGISTRY_URL_FLAG]) {
          merge(cheCluster, { spec: { components: { devfileRegistry: { disableInternalRegistry: true, externalDevfileRegistries: [{ url: flags[DEVFILE_REGISTRY_URL_FLAG] }] } } } })
        }

        if (flags[PLATFORM_FLAG] === 'minikube' || flags[PLATFORM_FLAG] === 'microk8s' || flags[PLATFORM_FLAG] === 'docker-desktop') {
          merge(cheCluster, { spec: { devEnvironments: { startTimeoutSeconds: 3000 } } })
        }

        // override default values with patch file
        if (ctx[EclipseCheContext.CR_PATCH]) {
          merge(cheCluster, ctx[EclipseCheContext.CR_PATCH])
        }

        await kubeHelper.createNamespacedCustomObject(flags[CHE_NAMESPACE_FLAG], EclipseChe.CHE_CLUSTER_API_GROUP, EclipseChe.CHE_CLUSTER_API_VERSION_V2, EclipseChe.CHE_CLUSTER_KIND_PLURAL, cheCluster, true)
        task.title = `${task.title}...[Created]`
      },
    }
  }
}
