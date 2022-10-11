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

import { OPENSHIFT_OPERATORS_NAMESPACE } from '../../../constants'
import { OLM, OLMInstallationUpdate } from '../../../api/context'
import * as Listr from 'listr'
import { CheHelper } from '../../../api/che'
import { KubeHelper } from '../../../api/kube'

export function getApproveInstallPlanTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const cheHelper = new CheHelper(flags)
  const kubeHelper = new KubeHelper(flags)

  return {
    title: 'Approve InstallPlan',
    task: async (ctx: any, task: any) => {
      const subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      if (!subscription) {
        throw new Error('Eclipse Che subscription not found.')
      }

      if (subscription.status) {
        if (subscription.status.state === 'AtLatestKnown') {
          task.title = `${task.title}...[Everything is up to date. Installed the latest known '${getVersionFromCSV(subscription.status.currentCSV)}' version]`
          return
        }

        if (subscription.status.state === 'UpgradeAvailable') {
          task.title = `${task.title}...[Upgrade is already in progress]`
          return
        }

        if (subscription.status.state === 'UpgradePending') {
          const installedCSV = subscription.status.installedCSV
          const currentCSV = subscription.status.currentCSV

          if (subscription.status.installplan?.name) {
            ctx[OLM.INSTALL_PLAN] = subscription.status.installplan.name
          } else {
            throw new Error('Eclipse Che InstallPlan name is empty.')
          }

          await kubeHelper.approveOperatorInstallationPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE)
          await kubeHelper.waitOperatorInstallPlan(ctx[OLM.INSTALL_PLAN], OPENSHIFT_OPERATORS_NAMESPACE, 60)
          if (installedCSV) {
            ctx.highlightedMessages.push(`Eclipse Che Operator is upgraded from '${getVersionFromCSV(installedCSV)}' to '${getVersionFromCSV(currentCSV)}' version`)
          } else {
            ctx.highlightedMessages.push(`Eclipse Che '${getVersionFromCSV(currentCSV)}' version installed`)
          }
          task.title = `${task.title}...[OK]`
          return
        }

        throw new Error(`Eclipse Che Subscription in '${subscription.status.state}' state.`)
      }

      throw new Error('Eclipse Che InstallPlan not found.')
    },
  }
}

export function getCheckInstallPlanApprovalStrategyTask(flags: any): Listr.ListrTask<Listr.ListrContext> {
  const cheHelper = new CheHelper(flags)

  return {
    title: 'Check InstallPlan approval strategy',
    task: async (ctx: any, task: Listr.ListrTaskWrapper<any>) => {
      const subscription = await cheHelper.findCheOperatorSubscription(OPENSHIFT_OPERATORS_NAMESPACE)
      if (!subscription) {
        throw new Error('Eclipse Che subscription not found.')
      }

      if (subscription.spec.installPlanApproval === OLMInstallationUpdate.AUTO) {
        task.title = `${task.title}...[${OLMInstallationUpdate.AUTO}]`
        throw new Error('Use \'chectl server:update\' command only with \'Manual\' InstallPlan approval strategy.')
      }

      task.title = `${task.title}...[${OLMInstallationUpdate.MANUAL}]`
    },
  }
}

function getVersionFromCSV(csvName: string): string {
  return csvName.substr(csvName.lastIndexOf('v') + 1)
}
