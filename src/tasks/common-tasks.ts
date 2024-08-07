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

import {CheCtlContext, CliContext, InfrastructureContext} from '../context'
import * as Listr from 'listr'
import { KubeClient } from '../api/kube-client'

import { ux } from '@oclif/core'
import {CreateResource, DeleteResource, IsResourceExists, ReplaceResource} from './installers/installer'
import {CHE_NAMESPACE_FLAG, PLATFORM_FLAG, SKIP_KUBE_HEALTHZ_CHECK_FLAG, SKIP_VERSION_CHECK_FLAG} from '../flags'
import {EclipseChe} from './installers/eclipse-che/eclipse-che'
import {addTrailingSlash, newError, newListr} from '../utils/utls'
import {K8sVersion} from '../utils/k8s-version'
import {Che} from '../utils/che'

export namespace CommonTasks {
  const OUTPUT_SEPARATOR = '-------------------------------------------------------------------------------'

  export function getTestKubernetesApiTasks(): Listr.ListrTask<any> {
    return {
      title: 'Verify Kubernetes API',
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        try {
          ux.info(`› Current Kubernetes context: '${kubeHelper.getCurrentContext()}'`)
          if (!flags[SKIP_KUBE_HEALTHZ_CHECK_FLAG]) {
            await kubeHelper.checkKubeApi()
          }

          task.title = `${task.title}...[${ctx[InfrastructureContext.KUBERNETES_VERSION]}]`

          if (!flags[SKIP_VERSION_CHECK_FLAG]) {
            const checkPassed = K8sVersion.checkMinimalK8sVersion(ctx[InfrastructureContext.KUBERNETES_VERSION])
            if (!checkPassed) {
              throw K8sVersion.getMinimalK8sVersionError(ctx[InfrastructureContext.KUBERNETES_VERSION])
            }
          }
        } catch (error: any) {
          return newError('Failed to connect to Kubernetes API. If you\'re sure that your Kubernetes cluster is healthy - you can skip this check with \'--skip-kubernetes-health-check\' flag.', error)
        }
      },
    }
  }

  export function getDeleteNamespaceTask(namespace: string): Listr.ListrTask<any> {
    return {
      title: `Delete Namespace ${namespace}`,
      task: async (ctx: any, task: any) => {
        if (namespace === 'openshift-operators') {
          return task.skip('openshift-operators namespace is protected and can not be deleted.')
        }

        const kubeHelper = KubeClient.getInstance()
        await kubeHelper.deleteNamespace(namespace)
        task.title = `${task.title}...[Deleted]`
      },
    }
  }

  export function getCreateNamespaceTask(namespaceName: string, labels: {}): Listr.ListrTask<any> {
    return {
      title: `Create Namespace ${namespaceName}`,
      task: async (_ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()

        const namespace = await kubeHelper.getNamespace(namespaceName)
        if (namespace) {
          await kubeHelper.waitNamespaceActive(namespaceName)
          task.title = `${task.title}...[Exists]`
        } else {
          const namespace = {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
              labels,
              name: namespaceName,
            },
          }

          await kubeHelper.createNamespace(namespace)
          await kubeHelper.waitNamespaceActive(namespaceName)
          task.title = `${task.title}...[Created]`
        }
      },
    }
  }

  export function getCreateOrUpdateResourceTask(
    isCreateOnly: boolean,
    resourceKind: string,
    resourceName: string,
    isExistsResource: IsResourceExists,
    createResource: CreateResource,
    replaceResource: ReplaceResource): Listr.ListrTask<any> {
    return {
      title: `${isCreateOnly ? 'Create' : 'Update'} ${resourceKind} ${resourceName}`,
      task: async (ctx: any, task: any) => {
        const exist = await isExistsResource()
        if (exist) {
          if (isCreateOnly) {
            task.title = `${task.title}...[Exists]`
          } else {
            await replaceResource()
            task.title = `${task.title}...[Updated]`
          }
        } else {
          await createResource()
          task.title = `${task.title}...[Created]`
        }
      },
    }
  }

  export function getSkipTask(title: string, skipMsg: string): Listr.ListrTask<any> {
    return {
      title,
      task: (_ctx: any, task: any) => {
        task.skip(skipMsg)
      },
    }
  }

  export function getNotEclipseCheResourceSkipTask(title: string): Listr.ListrTask<any> {
    return getSkipTask(title, `Not ${EclipseChe.PRODUCT_NAME} resource`)
  }

  export function getDisabledTask(): Listr.ListrTask<any> {
    return {
      title: '',
      enabled: () => false,
      task: async () => {},
    }
  }

  export function getCreateResourceTask(
    resourceKind: string,
    resourceName: string,
    isExistsResource: IsResourceExists,
    createResource: CreateResource): Listr.ListrTask<any> {
    return {
      title: `Create ${resourceKind} ${resourceName}`,
      task: async (ctx: any, task: any) => {
        const exist = await isExistsResource()
        if (exist) {
          task.title = `${task.title}...[Exists]`
        } else {
          await createResource()
          task.title = `${task.title}...[Created]`
        }
      },
    }
  }

  export function getDeleteResourcesTask(taskTitle: string, deleteResources: DeleteResource[]) {
    return {
      title: `${taskTitle}`,
      task: async (_ctx: any, task: any) => {
        let failed = false
        for (const deleteResource of deleteResources) {
          try {
            await deleteResource()
          } catch (e: any) {
            failed = true
            task.title = `${task.title}...[Failed: ${e.message}]`
          }
        }

        if (!failed) {
          task.title = `${task.title}...[Deleted]`
        }
      },
    }
  }

  export function getWaitTask(milliseconds: number): Listr.ListrTask<any> {
    return {
      title: 'Waiting',
      task: async (_ctx: any, task: any) => {
        await ux.wait(milliseconds)
        task.title = `${task.title}...[OK]`
      },
    }
  }

  export function getOpenShiftVersionTask(): Listr.ListrTask {
    return {
      title: 'OpenShift version',
      enabled: (ctx: any) => ctx[InfrastructureContext.IS_OPENSHIFT],
      task: async (ctx: any, task: any) => {
        task.title = `${task.title}...[${ctx[InfrastructureContext.OPENSHIFT_VERSION]}]`
      },
    }
  }

  export function getPreparePostInstallationOutputTask(): Listr.ListrTask<any> {
    return {
      title: 'Prepare post installation output',
      task: async (ctx: any, task: any) => {
        const flags = CheCtlContext.getFlags()
        const kubeHelper = KubeClient.getInstance()

        const messages: string[] = []

        const version = await Che.getCheVersion()
        messages.push(`${EclipseChe.PRODUCT_NAME} ${version.trim()} has been successfully deployed.`, `Documentation             : ${EclipseChe.DOC_LINK}`)
        if (EclipseChe.DOC_LINK_RELEASE_NOTES) {
          messages.push(`Release Notes           : ${EclipseChe.DOC_LINK_RELEASE_NOTES}`)
        }

        messages.push(OUTPUT_SEPARATOR)

        const dashboardURL = Che.buildDashboardURL(await Che.getCheURL(flags[CHE_NAMESPACE_FLAG]))
        messages.push(`Users Dashboard           : ${dashboardURL}`, OUTPUT_SEPARATOR)

        const cheConfigMap = await kubeHelper.getConfigMap(EclipseChe.CONFIG_MAP, flags[CHE_NAMESPACE_FLAG])
        if (cheConfigMap && cheConfigMap.data) {
          if (cheConfigMap.data.CHE_WORKSPACE_PLUGIN__REGISTRY__URL) {
            messages.push(`Plug-in Registry          : ${addTrailingSlash(cheConfigMap.data.CHE_WORKSPACE_PLUGIN__REGISTRY__URL)}`)
          }

          messages.push(OUTPUT_SEPARATOR)

          if (flags[PLATFORM_FLAG] === 'minikube') {
            messages.push('Dex user credentials      : che@eclipse.org:admin', 'Dex user credentials      : user1@che:password', 'Dex user credentials      : user2@che:password', 'Dex user credentials      : user3@che:password', 'Dex user credentials      : user4@che:password', 'Dex user credentials      : user5@che:password', OUTPUT_SEPARATOR)
          }
        }

        // eslint-disable-next-line unicorn/prefer-spread
        ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES] = messages.concat(ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES])
        task.title = `${task.title}...[OK]`
      },
    }
  }

  export function getPrintHighlightedMessagesTask(): Listr.ListrTask<any> {
    return {
      title: 'Show important messages',
      enabled: ctx => ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES].length > 0,
      task: (ctx: any) => {
        const tasks = newListr()
        for (const message of ctx[CliContext.CLI_COMMAND_POST_OUTPUT_MESSAGES]) {
          tasks.add({
            title: message,
            task: () => {},
          })
        }

        return tasks
      },
    }
  }

  export function getVerifyCommand(title: string, errorMsg: string, isVerifiedResource: () => Promise<boolean> | boolean): Listr.ListrTask<any> {
    return {
      title,
      task: async (_ctx: any, task: any) => {
        if (await isVerifiedResource()) {
          task.title = `${task.title}...[OK]`
        } else {
          ux.error(errorMsg, {exit: 1})
        }
      },
    }
  }
}
