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
import { integer } from '@oclif/parser/lib/flags'
import * as Listr from 'listr'

import { cheNamespace, listrRenderer } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { K8sTasks } from '../../tasks/platforms/k8s'

export default class Debug extends Command {
  static description = 'Enable local debug of Eclipse Che server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'debug-port': integer({
      description: 'Eclipse Che Server debug port',
      default: 8000
    })
  }

  async run() {
    const { flags } = this.parse(Debug)
    const ctx: any = {}

    const cheTasks = new CheTasks(flags)
    const k8sTasks = new K8sTasks()
    const tasks = new Listr([], { renderer: flags['listr-renderer'] as any })

    tasks.add(k8sTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))
    tasks.add(cheTasks.debugTask(flags))

    try {
      await tasks.run(ctx)
      this.log(`Eclipse Che Server debug is available on localhost:${flags['debug-port']}.`)
      this.log('The program keeps running to enable port forwarding.')
    } catch (error) {
      this.error(error)
    }
  }
}
