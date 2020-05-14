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
import { OLMTasks } from './olm'
import { OperatorTasks } from './operator'

/**
 * Tasks related to installation way.
 */
export class InstallerTasks {
  updateTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask
    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator Update'
      task = () => {
        return operatorTasks.updateTasks(flags, command)
      }
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running the Eclipse Che operator Update using OLM'
      task = () => {
        return olmTasks.updateTasks(flags, command)
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
    const olmTasks = new OLMTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask
    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator Update'
      task = () => {
        return operatorTasks.preUpdateTasks(flags, command)
      }
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running the Eclipse Che operator Update using OLM'
      task = () => {
        return olmTasks.preUpdateTasks(flags, command)
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
    const helmTasks = new HelmTasks(flags)
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()
    const minishiftAddonTasks = new MinishiftAddonTasks()

    let title: string
    let task: any

    // let task: Listr.ListrTask

    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator'
      task = () => {
        // The operator installs Eclipse Che in multiuser mode by default
        if (!flags.multiuser) {
          flags.multiuser = true
        }

        return operatorTasks.startTasks(flags, command)
      }
      // installer.ts BEGIN CHE ONLY
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running Olm installaion Eclipse Che'
      // The olm installs Eclipse Che in multiuser mode by default
      if (!flags.multiuser) {
        flags.multiuser = true
      }
      task = () => olmTasks.startTasks(flags, command)
    } else if (flags.installer === 'helm') {
      title = '🏃‍  Running Helm to install Eclipse Che'
      task = () => helmTasks.startTasks(flags, command)
    } else if (flags.installer === 'minishift-addon') {
      // minishift-addon supports Eclipse Che singleuser only
      if (flags.multiuser) {
        command.warn("Eclipse Che will be deployed in Single-User mode as 'minishift-addon' installer supports only that mode.")
        flags.multiuser = false
      }
      title = '🏃‍  Running the Eclipse Che minishift-addon'
      task = () => minishiftAddonTasks.startTasks(flags, command)
    // installer.ts END CHE ONLY
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
