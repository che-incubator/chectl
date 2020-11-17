/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command } from '@oclif/command'
import { cli } from 'cli-ux'

import { CheServerLoginManager } from '../../api/che-login-manager'

export default class Get extends Command {
  static description = 'Display active login session'

  async run() {
    await this.config.runHook('analytics', { event: Get.description, command: Get.id })

    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)
    const currentLogin = loginManager.getCurrentLoginInfo()
    if (currentLogin.username) {
      cli.info(`Logged into ${currentLogin.cheApiEndpoint} as ${currentLogin.username}`)
    } else {
      cli.info('There is no active login session')
    }
  }

}
