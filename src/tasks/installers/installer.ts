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

import Command from '@oclif/command'
import * as Listr from 'listr'

import { ChectlContext } from '../../api/context'

import { OLMTasks } from './olm'
import { OperatorTasks } from './operator'

/**
 * Tasks related to installation way.
 */
export class InstallerTasks {
  updateTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const operatorTasks = new OperatorTasks(flags)
    const olmTasks = new OLMTasks(flags)

    let title: string
    let task: any

    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator Update'
      task = (ctx: any) => {
        return new Listr(operatorTasks.updateTasks(), ctx.listrOptions)
      }
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running the Eclipse Che operator Update using OLM'
      task = () => {
        return olmTasks.updateTasks(flags, command)
      }
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => {
        command.error(`Installer ${flags.installer} does not support update ¯\\_(ツ)_/¯`)
      }
    }

    return [{
      title,
      task,
    }]
  }

  preUpdateTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const operatorTasks = new OperatorTasks(flags)
    const olmTasks = new OLMTasks(flags)

    let title: string
    let task: any

    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator Update'
      task = () => {
        return operatorTasks.preUpdateTasks()
      }
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running the Eclipse Che operator Update using OLM'
      task = () => {
        return olmTasks.preUpdateTasks(flags, command)
      }
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => {
        command.error(`Installer ${flags.installer} does not support update ¯\\_(ツ)_/¯`)
      }
    }

    return [{
      title,
      task,
    }]
  }

  async installTasks(flags: any, command: Command): Promise<ReadonlyArray<Listr.ListrTask>> {
    const ctx = ChectlContext.get()

    const operatorTasks = new OperatorTasks(flags)
    const olmTasks = new OLMTasks(flags)

    let title: string
    let task: any

    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator'
      task = async () => {
        return new Listr(await operatorTasks.deployTasks(), ctx.listrOptions)
      }
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running Olm installation Eclipse Che'
      task = () => new Listr(olmTasks.startTasks(flags, command), ctx.listrOptions)
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => {
        command.error(`Installer ${flags.installer} is not supported ¯\\_(ツ)_/¯`)
      }
    }

    return [{
      title,
      task,
    }]
  }
}
