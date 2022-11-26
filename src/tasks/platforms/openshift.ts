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

import * as commandExists from 'command-exists'
import * as Listr from 'listr'

import {OpenShift} from '../../utils/openshift'
import {CommonTasks} from '../common-tasks'

export namespace OpenshiftTasks {
  /**
   * Returns tasks list which perform preflight platform checks.
   */
  export function getPreflightCheckTasks(): Listr.ListrTask<any>[] {
    return [
      CommonTasks.getVerifyCommand('Verify if oc is installed', 'oc not found',  () => commandExists.sync('oc')),
      CommonTasks.getVerifyCommand('Verify if openshift is running', 'PLATFORM_NOT_READY: \'oc status\' command failed. Please login with \'oc login\' command and try again.',  () => OpenShift.isOpenShiftRunning()),
    ]
  }
}
