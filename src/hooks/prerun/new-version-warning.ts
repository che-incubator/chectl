/*********************************************************************
 * Copyright (c) 2021 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Hook } from '@oclif/config'
import { cli } from 'cli-ux'

import { VersionHelper } from '../../api/version'
import { CHECTL_PROJECT_NAME } from '../../constants'
import { getProjectName } from '../../util'

const isChectl = getProjectName() === CHECTL_PROJECT_NAME
const hook: Hook<'prerun'> = async function (options) {
  if (!isChectl) {
    return
  }

  const commandName: string = options.Command.id
  if (commandName === 'server:deploy' || commandName === 'server:update') {
    return
  }

  try {
    if (await VersionHelper.isChectlUpdateAvailable(options.config.cacheDir)) {
      cli.warn('A newer version of chectl is available. Run "chectl update" to update to the newer version.')
    }
  } catch {
    // An error occured while checking for newer version. Ignore it.
  }
}

export default hook
