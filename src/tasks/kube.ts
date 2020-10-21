/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { V1ContainerStateWaiting, V1PodCondition } from '@kubernetes/client-node'
import { cli } from 'cli-ux'
import * as Listr from 'listr'

import { KubeHelper } from '../api/kube'

export class KubeTasks {
  kubeHelper: KubeHelper
  constructor(flags?: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  podStartTasks(selector: string, namespace: string): Listr {
    return new Listr([
      {
        title: 'Scheduling',
        task: async (_ctx: any, task: any) => {
          // any way use 5 minutes (600*500=5*60*1000 ms) timeout
          for (let i = 1; i <= 600; i++) {
            const failedCondition = await this.getFailedPodCondition(namespace, selector, 'PodScheduled')
            if (failedCondition) {
              task.title = `${task.title}...failed`
              throw new Error(`Failed to schedule a pod, reason: ${failedCondition.reason}, message: ${failedCondition.message}`)
            }

            const allScheduled = await this.isPodConditionStatusPassed(namespace, selector, 'PodScheduled')
            if (allScheduled) {
              task.title = `${task.title}...done.`
              return
            }

            await cli.wait(500)
          }

          throw new Error(`Failed to schedule a pod: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      },
      {
        title: 'Downloading images',
        task: async (_ctx: any, task: any) => {
          // any way use 5 minutes (600*500=5*60*1000 ms) timeout
          for (let i = 1; i <= 600; i++) {
            const failedState = await this.getFailedWaitingState(namespace, selector, 'Pending')
            if (failedState) {
              task.title = `${task.title}...failed`
              throw new Error(`Failed to download image, reason: ${failedState.reason}, message: ${failedState.message}`)
            }

            const pods = await this.kubeHelper.getPodListByLabel(namespace, selector)
            const allRunning = !pods.some(value => !value.status || value.status.phase !== 'Running')
            if (pods.length && allRunning) {
              task.title = `${task.title}...done.`
              return
            }

            await cli.wait(500)
          }

          throw new Error(`Failed to download image: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      },
      {
        title: 'Starting',
        task: async (_ctx: any, task: any) => {
          // any way use 5 minutes (600*500=5*60*1000 ms) timeout
          for (let i = 1; i <= 600; i++) {
            const failedState = await this.getFailedWaitingState(namespace, selector, 'Running')
            if (failedState) {
              task.title = `${task.title}...failed`
              throw new Error(`Failed to start a pod, reason: ${failedState.reason}, message: ${failedState.message}`)
            }

            const allStarted = await this.isPodConditionStatusPassed(namespace, selector, 'Ready')
            if (allStarted) {
              task.title = `${task.title}...done.`
              return
            }

            await cli.wait(500)
          }

          throw new Error(`Failed to download image: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      }
    ])
  }

  private async getFailedPodCondition(namespace: string, selector: string, conditionType: string): Promise<V1PodCondition | undefined> {
    const status = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
    const failedPod = status.find(s => s.status === 'False' && s.message && s.reason)
    if (failedPod) {
      // wait 10 sec, check again and only then fail
      await cli.wait(10000)

      const condition = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
      return condition.find(s => s.status === 'False' && s.message && s.reason)
    }
  }

  private async isPodConditionStatusPassed(namespace: string, selector: string, conditionType: string): Promise<boolean> {
    const status = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
    const allScheduled = !status.some(s => s.status !== 'True')
    return !!status.length && allScheduled
  }

  /**
   * Checks if there is any reason for a given pod state and returns message if so.
   */
  private async getFailedWaitingState(namespace: string, selector: string, state: string): Promise<V1ContainerStateWaiting | undefined> {
    const waitingState = await this.kubeHelper.getPodWaitingState(namespace, selector, state)
    if (waitingState && waitingState.reason && waitingState.message) {
      // wait 10 sec, check again and only then fail
      await cli.wait(10000)

      const waitingState = await this.kubeHelper.getPodWaitingState(namespace, selector, state)
      if (waitingState && waitingState.reason && waitingState.message) {
        return waitingState
      }
    }
  }

  /**
   * Returns extended timeout error message explaining a failure.
   */
  private async getTimeOutErrorMessage(namespace: string, selector: string): Promise<string> {
    const pods = await this.kubeHelper.getPodListByLabel(namespace, selector)
    if (!pods.length) {
      return 'Timeout: there no pods.'
    }

    let errorMessage = 'Timeout:'
    for (const pod of pods) {
      errorMessage += `\nPod: ${pod.metadata!.name}`
      if (pod.status) {
        if (pod.status.containerStatuses) {
          errorMessage += `\n\t\tstatus: ${JSON.stringify(pod.status.containerStatuses, undefined, '  ')}`
        }
        if (pod.status.conditions) {
          errorMessage += `\n\t\tconditions: ${JSON.stringify(pod.status.conditions, undefined, '  ')}`
        }
      } else {
        errorMessage += ', status not found.'
      }
    }

    return errorMessage
  }
}
