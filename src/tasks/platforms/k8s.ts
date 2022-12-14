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

import * as Listr from 'listr'
import {CheCtlContext} from '../../context'
import {DOMAIN_FLAG} from '../../flags'
import {CommonTasks} from '../common-tasks'
import {isCommandExists} from '../../utils/utls'

export namespace K8sTasks {
  export function getPeflightCheckTasks(): Listr.ListrTask<any>[] {
    const flags = CheCtlContext.getFlags()

    return [
      CommonTasks.getVerifyCommand('Verify if kubectl is installed', 'kubectl not found', () => isCommandExists('kubectl')),
      CommonTasks.getVerifyCommand('Verify domain is set', `--${DOMAIN_FLAG} flag needs to be defined`, () => Boolean(flags[DOMAIN_FLAG])),
    ]
  }
}
