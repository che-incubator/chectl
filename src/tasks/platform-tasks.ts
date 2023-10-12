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
import {CheCtlContext, OIDCContext} from '../context'
import {KubeClient} from '../api/kube-client'
import {PLATFORM_FLAG, SKIP_OIDC_PROVIDER_FLAG} from '../flags'
import {EclipseChe} from './installers/eclipse-che/eclipse-che'

export namespace PlatformTasks {
  export function getEnsureOIDCProviderInstalledTask(): Listr.ListrTask {
    const flags = CheCtlContext.getFlags()
    return {
      title: 'Check if OIDC Provider installed',
      enabled: () => !flags[SKIP_OIDC_PROVIDER_FLAG],
      skip: () => {
        if (flags[PLATFORM_FLAG] === 'minikube') {
          return 'Dex will be automatically installed as OIDC Identity Provider'
        }
      },
      task: async (_ctx: any, task: any) => {
        const kubeHelper = KubeClient.getInstance()
        const apiServerPods = await kubeHelper.getPodListByLabel('kube-system', 'component=kube-apiserver')
        for (const pod of apiServerPods) {
          if (!pod.spec) {
            continue
          }

          for (const container of pod.spec.containers) {
            if (container.command && container.command.some(value => value.includes(OIDCContext.ISSUER_URL)) && container.command.some(value => value.includes(OIDCContext.CLIENT_ID))) {
              task.title = `${task.title}...[OK]`
              return
            }

            if (container.args && container.args.some(value => value.includes(OIDCContext.ISSUER_URL)) && container.args.some(value => value.includes(OIDCContext.CLIENT_ID))) {
              task.title = `${task.title}...[OK]`
              return
            }
          }
        }

        task.title = `${task.title}...[Not Found]`
        throw new Error(`API server is not configured with OIDC Identity Provider, see details ${EclipseChe.DOC_LINK_CONFIGURE_API_SERVER}. To bypass OIDC Provider check, use \'--skip-oidc-provider-check\' flag`)
      },
    }
  }
}
