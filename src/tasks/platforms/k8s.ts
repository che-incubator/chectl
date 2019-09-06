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
import * as commandExists from 'command-exists'
import * as Listr from 'listr'

import { KubeHelper } from '../../api/kube'

export class K8sTasks {
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

  /**
   * Returns tasks list which perform preflight platform checks.
   */
  startTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if kubectl is installed',
        task: () => {
          if (!commandExists.sync('kubectl')) {
            command.error('E_REQUISITE_NOT_FOUND')
          }
        }
      },
      {
        title: 'Verify remote kubernetes status',
        task: async (_ctx: any, task: any) => {
          const kh = new KubeHelper(flags)
          try {
            await kh.checkKubeApi()
            task.title = `${task.title}...done.`
          } catch (error) {
            command.error('E_PLATFORM_NOT_READY: ' + error)
          }
        }
      },
      // Should automatically compute route if missing
      {
        title: 'Verify domain is set',
        task: (_ctx: any, task: any) => {
          if (flags.domain === undefined || flags.domain === '') {
            command.error('E_MISSING_ARGUMENT: the domain parameter needs to be defined.')
          }
          task.title = `${task.title}...set to ${flags.domain}.`
        }
      },
    ],
      { renderer: flags['listr-renderer'] as any }
    )
  }
}
