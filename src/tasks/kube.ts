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
  private readonly interval = 500
  private readonly kubeHelper: KubeHelper
  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  podStartTasks(selector: string, namespace: string): Listr {
    return new Listr([
      {
        title: 'Scheduling',
        task: async (_ctx: any, task: any) => {
          const taskTitle = task.title
          const iterations = this.kubeHelper.podWaitTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            // check 'PodScheduled' condition
            const failedCondition = await this.getFailedPodCondition(namespace, selector, 'PodScheduled')
            if (failedCondition) {
              task.title = `${taskTitle}...failed, rechecking...`

              // for instance we need some time for pvc provisioning...
              await cli.wait(this.kubeHelper.podErrorRecheckTimeout)

              const failedCondition = await this.getFailedPodCondition(namespace, selector, 'PodScheduled')
              if (failedCondition) {
                task.title = `${taskTitle}...failed`
                throw new Error(`Failed to schedule a pod, reason: ${failedCondition.reason}, message: ${failedCondition.message}. Consider increasing error recheck timeout with --k8spoderrorrechecktimeout flag.`)
              }
            }

            const allScheduled = await this.isPodConditionStatusPassed(namespace, selector, 'PodScheduled')
            if (allScheduled) {
              task.title = `${taskTitle}...done`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to schedule a pod: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      },
      {
        title: 'Downloading images',
        task: async (_ctx: any, task: any) => {
          const taskTitle = task.title
          const iterations = this.kubeHelper.podDownloadImageTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            const failedState = await this.getFailedWaitingState(namespace, selector, 'Pending')
            if (failedState) {
              task.title = `${taskTitle}...failed, rechecking...`
              await cli.wait(this.kubeHelper.podErrorRecheckTimeout)

              const failedState = await this.getFailedWaitingState(namespace, selector, 'Pending')
              if (failedState) {
                task.title = `${taskTitle}...failed`
                throw new Error(`Failed to download image, reason: ${failedState.reason}, message: ${failedState.message}.`)
              }
            }

            const pods = await this.kubeHelper.getPodListByLabel(namespace, selector)
            const allRunning = !pods.some(value => !value.status || value.status.phase !== 'Running')
            if (pods.length && allRunning) {
              task.title = `${taskTitle}...done`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to download image: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      },
      {
        title: 'Starting',
        task: async (_ctx: any, task: any) => {
          const taskTitle = task.title
          const iterations = this.kubeHelper.podReadyTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            const failedState = await this.getFailedWaitingState(namespace, selector, 'Running')
            if (failedState) {
              task.title = `${taskTitle}...failed, rechecking...`
              await cli.wait(this.kubeHelper.podErrorRecheckTimeout)

              const failedState = await this.getFailedWaitingState(namespace, selector, 'Running')
              if (failedState) {
                task.title = `${taskTitle}...failed`
                throw new Error(`Failed to start a pod, reason: ${failedState.reason}, message: ${failedState.message}`)
              }
            }

            const terminatedState = await this.kubeHelper.getPodLastTerminatedState(namespace, selector)
            if (terminatedState) {
              task.title = `${taskTitle}...failed`
              let errorMsg = `Failed to start a pod, reason: ${terminatedState.reason}`
              terminatedState.message && (errorMsg += `, message: ${terminatedState.message}`)
              terminatedState.exitCode && (errorMsg += `, exitCode: ${terminatedState.exitCode}`)
              terminatedState.signal && (errorMsg += `, signal: ${terminatedState.signal}`)
              throw new Error(errorMsg)
            }

            const allStarted = await this.isPodConditionStatusPassed(namespace, selector, 'Ready')
            if (allStarted) {
              task.title = `${taskTitle}...done`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to start a pod: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        }
      }
    ])
  }

  private async getFailedPodCondition(namespace: string, selector: string, conditionType: string): Promise<V1PodCondition | undefined> {
    const status = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
    return status.find(s => s.status === 'False' && s.message && s.reason)
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
      return waitingState
    }
  }

  /**
   * Returns extended timeout error message explaining a failure.
   */
  private async getTimeOutErrorMessage(namespace: string, selector: string): Promise<string> {
    const pods = await this.kubeHelper.getPodListByLabel(namespace, selector)
    if (!pods.length) {
      throw new Error(`Timeout: there are no pods in the namespace: ${namespace}, selector: ${selector}. Check Eclipse Che logs for details. Consider increasing error recheck timeout with --k8spoderrorrechecktimeout flag.`)
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
