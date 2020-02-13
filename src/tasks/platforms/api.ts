/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { Command } from '@oclif/command'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'

export class ApiTasks {
   /**
    * Returns tasks which tests if K8s or OpenShift API is configured in the current context.
    *
    * `isOpenShift` property is provisioned into context.
    */
  testApiTasks(flags: any, command: Command): Listr.ListrTask {
    let kube = new KubeHelper(flags)
    return {
      title: 'Verify Kubernetes API',
      task: async (ctx: any, task: any) => {
        try {
          await kube.checkKubeApi()
          ctx.isOpenShift = await kube.isOpenShift()
          task.title = await `${task.title}...OK`
          if (ctx.isOpenShift) {
            task.title = await `${task.title} (it's OpenShift)`
          }
        } catch (error) {
          command.error(`Failed to connect to Kubernetes API. ${error.message}`)
        }
      }
    }
  }
}
