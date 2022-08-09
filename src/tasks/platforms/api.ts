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
import { ChectlContext } from '../../api/context'

import { KubeHelper } from '../../api/kube'
import { newError } from '../../util'

export class ApiTasks {
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
          task.title = `${task.title}...[OK]`

          if (ctx[ChectlContext.IS_OPENSHIFT]) {
            task.title = `${task.title} [OpenShift]`
          }
        } catch (error: any) {
          return newError('Failed to connect to Kubernetes API. If you\'re sure that your Kubernetes cluster is healthy - you can skip this check with \'--skip-kubernetes-health-check\' flag.', error)
        }
      },
    }
  }
}
