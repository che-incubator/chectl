/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { cli } from 'cli-ux'

import { CheServerLoginManager } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { CHE_TELEMETRY } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'

export default class Get extends Command {
  static description = 'Display active login session'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    telemetry: CHE_TELEMETRY
  }
  async run() {
    const { flags } = this.parse(Get)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Get.id, flags })

    const loginManager = await CheServerLoginManager.getInstance()
    const currentLogin = loginManager.getCurrentLoginInfo()
    if (currentLogin.username) {
      cli.info(`Logged into ${currentLogin.cheApiEndpoint} as ${currentLogin.username}`)
    } else {
      cli.info('There is no active login session')
    }
  }

}
