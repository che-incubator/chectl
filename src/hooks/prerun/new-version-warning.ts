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

import { Hook } from '@oclif/core'
import { ux } from '@oclif/core'

import { CheCtlVersion } from '../../utils/chectl-version'
import {isCheFlavor} from '../../utils/utls'

const DO_NO_PRINT_WARNING_COMMANDS = new Set([
  'server:deploy',
  'server:update',
  'update',
  'version',
])

const hook: Hook<'prerun'> = async function (options) {
  if (!isCheFlavor()) {
    return
  }

  const commandName: string = options.Command.id
  if (DO_NO_PRINT_WARNING_COMMANDS.has(commandName)) {
    // Do nothing
    return
  }

  try {
    if (await CheCtlVersion.isCheCtlUpdateAvailable(options.config.cacheDir)) {
      ux.warn('A newer version of chectl is available. Run "chectl update" to update to the newer version.')
    }
  } catch {
    // An error occured while checking for newer version. Ignore it.
  }
}

export default hook
