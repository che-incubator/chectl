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
import { cli } from 'cli-ux'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'
import { newError } from '../../util'

export class ApiTasks {
  /**
   * Returns tasks which tests if K8s or OpenShift API is configured in the current context.
   *
   * `isOpenShift` property is provisioned into context.
   */
  testApiTasks(flags: any): Listr.ListrTask {
    const kube = new KubeHelper(flags)
    return {
      title: 'Verify Kubernetes API',
      task: async (ctx: any, task: any) => {
        try {
          cli.info(`› Current Kubernetes context: '${await kube.currentContext()}'`)
          if (!flags['skip-kubernetes-health-check']) {
            await kube.checkKubeApi()
          }
          task.title = `${task.title}...OK`
          ctx.isOpenShift = await kube.isOpenShift()
          ctx.isOpenShift4 = await kube.isOpenShift4()

          if (ctx.isOpenShift) {
            task.title = `${task.title} (it's OpenShift)`
          }
        } catch (error) {
          return newError('Failed to connect to Kubernetes API. If you\'re sure that your Kubernetes cluster is healthy - you can skip this check with \'--skip-kubernetes-health-check\' flag.', error)
        }
      },
    }
  }
}
