/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { boolean } from '@oclif/command/lib/flags'
import { cli } from 'cli-ux'
import * as Listrq from 'listr'

import { KubeHelper } from '../../api/kube'
import { cheDeployment, cheNamespace, devWorkspaceControllerNamespace, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { DevWorkspaceTasks } from '../../tasks/component-installers/devfile-workspace-operator-installer'
import { HelmTasks } from '../../tasks/installers/helm'
import { MinishiftAddonTasks } from '../../tasks/installers/minishift-addon'
import { OLMTasks } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { ApiTasks } from '../../tasks/platforms/api'

export default class Delete extends Command {
  static description = 'delete any Eclipse Che related resource: Kubernetes/OpenShift/Helm'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'dev-workspace-controller-namespace': devWorkspaceControllerNamespace,
    'delete-namespace': boolean({
      description: 'Indicates that a Eclipse Che namespace will be deleted as well',
      default: false
    }),
    'deployment-name': cheDeployment,
    'listr-renderer': listrRenderer,
    'skip-deletion-check': boolean({
      description: 'Skip user confirmation on deletion check',
      default: false
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  async run() {
    const { flags } = this.parse(Delete)

    const notifier = require('node-notifier')

    const apiTasks = new ApiTasks()
    const helmTasks = new HelmTasks(flags)
    const minishiftAddonTasks = new MinishiftAddonTasks()
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()
    const cheTasks = new CheTasks(flags)
    const devWorkspaceTasks = new DevWorkspaceTasks(flags)

    let tasks = new Listrq(undefined,
      { renderer: flags['listr-renderer'] as any }
    )

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(operatorTasks.deleteTasks(flags))
    tasks.add(olmTasks.deleteTasks(flags))
    tasks.add(cheTasks.deleteTasks(flags))
    tasks.add(devWorkspaceTasks.getUninstallTasks())
    tasks.add(helmTasks.deleteTasks(flags))
    tasks.add(minishiftAddonTasks.deleteTasks(flags))
    tasks.add(cheTasks.waitPodsDeletedTasks())
    if (flags['delete-namespace']) {
      tasks.add(cheTasks.deleteNamespace(flags))
    }

    const cluster = KubeHelper.KUBE_CONFIG.getCurrentCluster()
    if (!cluster) {
      throw new Error('Failed to get current Kubernetes cluster. Check if the current context is set via kubect/oc')
    }

    if (!flags['skip-deletion-check']) {
      const confirmed = await cli.confirm(`You're going to remove Eclipse Che server in namespace '${flags.chenamespace}' on server '${cluster ? cluster.server : ''}'. If you want to continue - press Y`)
      if (!confirmed) {
        this.exit(0)
      }
    }

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:delete has completed.'
    })

    this.exit(0)
  }
}
