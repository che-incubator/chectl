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

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as Listr from 'listr'

import { OpenShiftHelper } from '../../api/openshift'
import { VersionHelper } from '../../api/version'

export class OpenshiftTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  preflightCheckTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if oc is installed',
        task: (_ctx: any, task: any) => {
          if (!commandExists.sync('oc')) {
            command.error('E_REQUISITE_NOT_FOUND')
          } else {
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: 'Verify if openshift is running',
        task: async (_ctx: any, task: any) => {
          const openShiftHelper = new OpenShiftHelper()
          if (!await openShiftHelper.isOpenShiftRunning()) {
            command.error('PLATFORM_NOT_READY: \'oc status\' command failed. Please login with \'oc login\' command and try again.')
          } else {
            task.title = `${task.title}...[OK]`
          }
        },
      },
      VersionHelper.getOpenShiftCheckVersionTask(flags),
      VersionHelper.getK8sCheckVersionTask(flags),
    ], { renderer: flags['listr-renderer'] as any })
  }
}
