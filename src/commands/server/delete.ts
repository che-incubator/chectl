/**
 * Copyright (c) 2021 Red Hat, Inc.
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
import Listr = require('listr')

import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, batch, cheDeployment, cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { DevWorkspaceTasks } from '../../tasks/component-installers/devfile-workspace-operator-installer'
import { HelmTasks } from '../../tasks/installers/helm'
import { OLMTasks } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandErrorMessage, getCommandSuccessMessage, notifyCommandCompletedSuccessfully } from '../../util'

export default class Delete extends Command {
  static description = 'delete any Eclipse Che related resource: Kubernetes/OpenShift/Helm'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    batch,
    'delete-namespace': boolean({
      description: 'Indicates that a Eclipse Che namespace will be deleted as well',
      default: false
    }),
    'deployment-name': cheDeployment,
    'listr-renderer': listrRenderer,
    'skip-deletion-check': boolean({
      description: 'Skip user confirmation on deletion check',
      default: false,
      hidden: true,
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    yes: assumeYes,
    telemetry: CHE_TELEMETRY
  }

  async run() {
    const { flags } = this.parse(Delete)
    const ctx = await ChectlContext.initAndGet(flags, this)

    flags.chenamespace = await findWorkingNamespace(flags)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })

    if (flags['skip-deletion-check']) {
      this.warn('\'--skip-deletion-check\' flag is deprecated, use \'--yes\' instead.')
      flags.yes = flags['skip-deletion-check']
    }

    const apiTasks = new ApiTasks()
    const kube = new KubeHelper(flags)
    const helmTasks = new HelmTasks(flags)
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()
    const cheTasks = new CheTasks(flags)
    const devWorkspaceTasks = new DevWorkspaceTasks(flags)

    const tasks = new Listrq([], ctx.listrOptions)
    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(operatorTasks.deleteTasks(flags))
    tasks.add(olmTasks.deleteTasks(flags))
    tasks.add(cheTasks.deleteTasks(flags))
    tasks.add(helmTasks.deleteTasks(flags))
    tasks.add(cheTasks.waitPodsDeletedTasks())

    // Remove devworkspace controller only if there are no more cheClusters after olm/operator tasks
    tasks.add({
      title: 'Uninstall DevWorkspace Controller and DevWorkspace Che Controller',
      task: async (_ctx: any, task: any) => {
        const checlusters = await kube.getAllCheClusters()
        if (checlusters.length === 0) {
          return new Listr(devWorkspaceTasks.getUninstallTasks())
        }
        task.title = `${task.title}...Skipped: another Eclipse Che deployment found.`
      }})

    if (flags['delete-namespace']) {
      tasks.add(cheTasks.deleteNamespace(flags))
    }

    if (flags.batch || await this.isDeletionConfirmed(flags)) {
      try {
        await tasks.run()
        cli.log(getCommandSuccessMessage())
      } catch (err) {
        this.error(getCommandErrorMessage(err))
      }
    } else {
      this.exit(0)
    }

    notifyCommandCompletedSuccessfully()
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
