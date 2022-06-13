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

import { Command, flags } from '@oclif/command'
import { boolean } from '@oclif/command/lib/flags'
import { cli } from 'cli-ux'
import * as Listrq from 'listr'
import { OLMDevWorkspaceTasks } from '../../tasks/installers/olm-dev-workspace-operator'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, batch, cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import {
  DEFAULT_ANALYTIC_HOOK_NAME,
  DEFAULT_CHE_NAMESPACE,
  DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE,
  DEFAULT_OPENSHIFT_OPERATORS_NS_NAME
} from '../../constants'
import { CheTasks } from '../../tasks/che'
import { DevWorkspaceTasks } from '../../tasks/component-installers/devfile-workspace-operator-installer'
import { OLMTasks } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'
import Listr = require('listr')

export default class Delete extends Command {
  static description = 'delete any Eclipse Che related resource: Kubernetes/OpenShift'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    batch,
    'delete-namespace': boolean({
      description: 'Indicates that a Eclipse Che namespace will be deleted as well',
      default: false,
    }),
    'listr-renderer': listrRenderer,
    'skip-deletion-check': boolean({
      description: 'Skip user confirmation on deletion check',
      default: false,
      hidden: true,
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    yes: assumeYes,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Delete)
    const ctx = await ChectlContext.initAndGet(flags, this)

    flags.chenamespace = flags.chenamespace || await findWorkingNamespace(flags) || DEFAULT_CHE_NAMESPACE

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })

    if (flags['skip-deletion-check']) {
      this.warn('\'--skip-deletion-check\' flag is deprecated, use \'--yes\' instead.')
      flags.yes = flags['skip-deletion-check']
    }

    const apiTasks = new ApiTasks()
    const kube = new KubeHelper(flags)
    const operatorTasks = new OperatorTasks(flags)
    const olmTasks = new OLMTasks(flags)
    const cheTasks = new CheTasks(flags)
    const olmDevWorkspaceTasks = new OLMDevWorkspaceTasks(flags)
    const devWorkspaceTasks = new DevWorkspaceTasks(flags)

    const tasks = new Listrq([], ctx.listrOptions)
    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add({
      title: 'Delete operator resources',
      task: () => new Listr(operatorTasks.getDeleteTasks(flags)),
    })
    tasks.add({
      title: 'Delete OLM resources',
      task: () => new Listr(olmTasks.getDeleteTasks(flags)),
    })
    tasks.add({
      title: 'Wait until all pods are deleted',
      task: () => new Listr(cheTasks.getWaitPodsDeletedTasks()),
    })

    // Remove devworkspace controller only if there are no more cheClusters after olm/operator tasks
    tasks.add({
      title: 'Uninstall Dev Workspace Operator',
      task: async (_ctx: any, task: any) => {
        try {
          const checlusters = await kube.getAllCheClusters()
          if (checlusters.length === 0) {
            const tasks = new Listr()

            if (await olmDevWorkspaceTasks.isCustomDevWorkspaceCatalogExists()) {
              tasks.add(devWorkspaceTasks.deleteDevOperatorCRsAndCRDsTasks())
              tasks.add(olmDevWorkspaceTasks.deleteResourcesTasks())
              tasks.add(devWorkspaceTasks.deleteDevWorkspaceWebhooksTasks(DEFAULT_OPENSHIFT_OPERATORS_NS_NAME))
            }

            if (!await olmDevWorkspaceTasks.isDevWorkspaceOperatorInstalledViaOLM()) {
              tasks.add(devWorkspaceTasks.deleteDevOperatorCRsAndCRDsTasks())
              tasks.add(devWorkspaceTasks.deleteResourcesTasks())
              tasks.add(devWorkspaceTasks.deleteDevWorkspaceWebhooksTasks(DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE))
            }

            return tasks
          }

          task.title = `${task.title}...[Skipped: another Eclipse Che instance found]`
        } catch (e: any) {
          task.title = `${task.title}...[Failed: ${e.message}]`
        }
      },
    })

    if (flags['delete-namespace']) {
      tasks.add(cheTasks.getDeleteNamespaceTasks(flags))
    }

    if (flags.batch || await this.isDeletionConfirmed(flags)) {
      try {
        await tasks.run()
        cli.log(getCommandSuccessMessage())
      } catch (err: any) {
        this.error(wrapCommandError(err))
      }
    } else {
      this.exit(0)
    }

    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }

  async isDeletionConfirmed(flags: any): Promise<boolean> {
    const kc = new KubeHelper(flags)
    const cluster = kc.kubeConfig.getCurrentCluster()

    if (!cluster) {
      throw new Error('Failed to get current Kubernetes cluster. Check if the current context is set via kubectl/oc')
    }

    if (!flags.batch && !flags.yes) {
      return cli.confirm(`You're going to remove Eclipse Che server in namespace '${flags.chenamespace}' on server '${cluster ? cluster.server : ''}'. If you want to continue - press Y`)
    }

    return true
  }
}
