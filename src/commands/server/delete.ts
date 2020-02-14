/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { KubeConfig } from '@kubernetes/client-node'
import { Command, flags } from '@oclif/command'
import { boolean } from '@oclif/command/lib/flags'
import { cli } from 'cli-ux'
import * as Listrq from 'listr'

import { cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { HelmTasks } from '../../tasks/installers/helm'
import { MinishiftAddonTasks } from '../../tasks/installers/minishift-addon'
import { OperatorTasks } from '../../tasks/installers/operator'
import { ApiTasks } from '../../tasks/platforms/api'

export default class Delete extends Command {
  static description = 'delete any Eclipse Che related resource: Kubernetes/OpenShift/Helm'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'skip-deletion-check': boolean({
      description: 'Skip user confirmation on deletion check',
      default: false
    }),
  }

  async run() {
    const { flags } = this.parse(Delete)

    const notifier = require('node-notifier')

    const apiTasks = new ApiTasks()
    const helmTasks = new HelmTasks()
    const msAddonTasks = new MinishiftAddonTasks()
    const operatorTasks = new OperatorTasks()
    const cheTasks = new CheTasks(flags)

    let tasks = new Listrq(undefined,
      { renderer: flags['listr-renderer'] as any }
    )

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(operatorTasks.deleteTasks(flags))
    tasks.add(cheTasks.deleteTasks(flags))
    tasks.add(helmTasks.deleteTasks(flags))
    tasks.add(msAddonTasks.deleteTasks(flags))

    const kc = new KubeConfig()
    kc.loadFromDefault()

    const cluster = kc.getCurrentCluster()
    const context = kc.getContextObject(kc.getCurrentContext())

    if (!flags['skip-deletion-check']) {
      const confirmed = await cli.confirm(`You're going to remove Eclipse Che server in namespace '${context ? context.namespace : ''}' on server '${cluster ? cluster.server : ''}'. If you want to continue - press Y`)
      if (!confirmed) {
        this.exit(0)
      }
    }

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:update has completed.'
    })

    this.exit(0)
  }
}
