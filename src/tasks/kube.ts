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
import { KubeHelper } from '../api/kube'

interface FailState {
  reason?: string
  message?: string
}

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
          const iterations = this.kubeHelper.podWaitTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            // check cheCluster status
            const cheClusterFailState = await this.getCheClusterFailState(namespace)
            // check 'PodScheduled' condition
            const podFailState = await this.getPodFailState(namespace, selector, 'PodScheduled')

            if (cheClusterFailState || podFailState) {
              const iterations = this.kubeHelper.podErrorRecheckTimeout / 1000
              let cheClusterFailState: FailState | undefined
              let podFailState: FailState | undefined

              for (let j = 0; j < iterations; j++) {
                await cli.wait(1000)

                cheClusterFailState = await this.getCheClusterFailState(namespace)
                podFailState = await this.getPodFailState(namespace, selector, 'PodScheduled')

                if (!cheClusterFailState && !podFailState) {
                  break
                }
              }

              if (cheClusterFailState) {
                throw new Error(`Eclipse Che operator failed, reason: ${cheClusterFailState.reason}, message: ${cheClusterFailState.message}. Consider increasing error recheck timeout with --k8spoderrorrechecktimeout flag.`)
              }

              if (podFailState) {
                throw new Error(`Failed to schedule a pod, reason: ${podFailState.reason}, message: ${podFailState.message}. Consider increasing error recheck timeout with --k8spoderrorrechecktimeout flag.`)
              }
            }

            const allScheduled = await this.isPodConditionStatusPassed(namespace, selector, 'PodScheduled')
            if (allScheduled) {
              task.title = `${task.title}...[OK]`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to schedule a pod: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        },
      },
      {
        title: 'Downloading images',
        task: async (_ctx: any, task: any) => {
          const iterations = this.kubeHelper.podDownloadImageTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            const failedState = await this.getContainerFailState(namespace, selector, 'Pending')
            if (failedState) {
              const iterations = this.kubeHelper.podErrorRecheckTimeout / 1000
              let failedState: FailState | undefined

              for (let j = 0; j < iterations; j++) {
                await cli.wait(1000)

                failedState = await this.getContainerFailState(namespace, selector, 'Pending')

                if (!failedState) {
                  break
                }
              }

              if (failedState) {
                throw new Error(`Failed to download image, reason: ${failedState.reason}, message: ${failedState.message}.`)
              }
            }

            const pods = await this.kubeHelper.getPodListByLabel(namespace, selector)
            const allRunning = !pods.some(value => !value.status || value.status.phase !== 'Running')
            if (pods.length && allRunning) {
              task.title = `${task.title}...[OK]`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to download image: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        },
      },
      {
        title: 'Starting',
        task: async (_ctx: any, task: any) => {
          const iterations = this.kubeHelper.podReadyTimeout / this.interval
          for (let i = 1; i <= iterations; i++) {
            // check cheCluster status
            const cheClusterFailState = await this.getCheClusterFailState(namespace)
            const failedState = await this.getContainerFailState(namespace, selector, 'Running')
            if (cheClusterFailState || failedState) {
              const iterations = this.kubeHelper.podErrorRecheckTimeout / 1000
              let cheClusterFailState: FailState | undefined
              let failedState: FailState | undefined

              for (let j = 0; j < iterations; j++) {
                await cli.wait(1000)

                cheClusterFailState = await this.getCheClusterFailState(namespace)
                failedState = await this.getContainerFailState(namespace, selector, 'Running')

                if (!cheClusterFailState && !failedState) {
                  break
                }
              }

              if (cheClusterFailState) {
                throw new Error(`Eclipse Che operator failed, reason: ${cheClusterFailState.reason}, message: ${cheClusterFailState.message}. Consider increasing error recheck timeout with --k8spoderrorrechecktimeout flag.`)
              }

              if (failedState) {
                throw new Error(`Failed to start a pod, reason: ${failedState.reason}, message: ${failedState.message}`)
              }
            }

            const terminatedState = await this.kubeHelper.getPodLastTerminatedState(namespace, selector)
            if (terminatedState) {
              let errorMsg = `Failed to start a pod, reason: ${terminatedState.reason}`
              terminatedState.message && (errorMsg += `, message: ${terminatedState.message}`)
              terminatedState.exitCode && (errorMsg += `, exitCode: ${terminatedState.exitCode}`)
              terminatedState.signal && (errorMsg += `, signal: ${terminatedState.signal}`)
              throw new Error(errorMsg)
            }

            const allStarted = await this.isPodConditionStatusPassed(namespace, selector, 'Ready')
            if (allStarted) {
              task.title = `${task.title}...[OK]`
              return
            }

            await cli.wait(this.interval)
          }

          throw new Error(`Failed to start a pod: ${await this.getTimeOutErrorMessage(namespace, selector)}`)
        },
      },
    ])
  }

  private async getPodFailState(namespace: string, selector: string, conditionType: string): Promise<FailState | undefined> {
    const status = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
    return status.find(s => s.status === 'False' && s.message && s.reason)
  }

  private async isPodConditionStatusPassed(namespace: string, selector: string, conditionType: string): Promise<boolean> {
    const status = await this.kubeHelper.getPodCondition(namespace, selector, conditionType)
    const allScheduled = !status.some(s => s.status !== 'True')
    return Boolean(status.length) && allScheduled
  }

  /**
   * Checks if there is any reason for a given pod state and returns message if so.
   */
  private async getContainerFailState(namespace: string, selector: string, state: string): Promise<FailState | undefined> {
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

  private async getCheClusterFailState(namespace: string): Promise<FailState | undefined> {
    const cheCluster = await this.kubeHelper.getCheClusterV1(namespace)
    if (cheCluster && cheCluster.status && cheCluster.status.reason && cheCluster.status.message) {
      return cheCluster.status
    }
  }
}
