/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command from '@oclif/command'
import * as Listr from 'listr'

import { HelmTasks } from './helm'
import { MinishiftAddonTasks } from './minishift-addon'
import { OperatorTasks } from './operator'

/**
 * Tasks related to installation way.
 */
export class InstallerTasks {
  updateTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const operatorTasks = new OperatorTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask
    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Che Operator Update'
      task = () => {
        return operatorTasks.updateTasks(flags, command)
      }
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => { command.error(`Installer ${flags.installer} does not support update ¯\\_(ツ)_/¯`) }
    }

    return [{
      title,
      task
    }]
  }

  preUpdateTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const operatorTasks = new OperatorTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask
    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Che Operator Update'
      task = () => {
        return operatorTasks.preUpdateTasks(flags, command)
      }
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => { command.error(`Installer ${flags.installer} does not support update ¯\\_(ツ)_/¯`) }
    }

    return [{
      title,
      task
    }]
  }

  installTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const helmTasks = new HelmTasks()
    const operatorTasks = new OperatorTasks()
    const minishiftAddonTasks = new MinishiftAddonTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask
    if (flags.installer === 'helm') {
      title = '🏃‍  Running Helm to install Eclipse Che'
      task = () => helmTasks.startTasks(flags, command)
    } else if (flags.installer === 'operator') {
      title = '🏃‍  Running the Che Operator'
      task = () => {
        // The operator installs Eclipse Che multiuser only
        if (!flags.multiuser) {
          command.warn("Eclipse Che will be deployed in Multi-User mode since Configured 'operator' installer which support only such.")
          flags.multiuser = true
        }

        return operatorTasks.startTasks(flags, command)
      }
    } else if (flags.installer === 'minishift-addon') {
      // minishift-addon supports Eclipse Che singleuser only
      if (flags.multiuser) {
        command.warn("Eclipse Che will be deployed in Single-User mode since Configured 'minishift-addon' installer which support only such.")
        flags.multiuser = false
      }
      title = '🏃‍  Running the Eclipse Che minishift-addon'
      task = () => minishiftAddonTasks.startTasks(flags, command)
    } else {
      title = '🏃‍  Installer preflight check'
      task = () => { command.error(`Installer ${flags.installer} is not supported ¯\\_(ツ)_/¯`) }
    }

    return [{
      title,
      task
    }]
  }
}
