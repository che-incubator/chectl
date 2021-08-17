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

import { HelmTasks } from './helm'
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
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()

    let title: string
    let task: any

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
      task = () => {
        command.error(`Installer ${flags.installer} does not support update ¯\\_(ツ)_/¯`)
      }
    }

    return [{
      title,
      task,
    }]
  }

  installTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    const helmTasks = new HelmTasks(flags)
    const operatorTasks = new OperatorTasks()
    const olmTasks = new OLMTasks()

    let title: string
    let task: any

    if (flags.installer === 'operator') {
      title = '🏃‍  Running the Eclipse Che operator'
      task = () => operatorTasks.deployTasks(flags, command)
    } else if (flags.installer === 'olm') {
      title = '🏃‍  Running Olm installaion Eclipse Che'
      task = () => olmTasks.startTasks(flags, command)
    // installer.ts BEGIN CHE ONLY
    } else if (flags.installer === 'helm') {
      title = '🏃‍  Running Helm to install Eclipse Che'
      task = () => helmTasks.deployTasks(flags, command)
    // installer.ts END CHE ONLY
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
