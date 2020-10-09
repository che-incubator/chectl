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

import { CheApiClient } from '../../api/che-api-client'
import { CheServerLoginManager } from '../../api/che-login-manager'
import { cheApiEndpoint, CHE_API_ENDPOINT_KEY, username, USERNAME_KEY } from '../../common-flags'

export default class Use extends Command {
  static description = 'switches to another login session'

  static flags = {
    help: flags.help({ char: 'h' }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [USERNAME_KEY]: username,
  }

  async run() {
    const { flags } = this.parse(Use)

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    let username = flags[USERNAME_KEY]

    if (!cheApiEndpoint && !username) {
      throw new Error('No arguments provided')
    }

    if (cheApiEndpoint) {
      cheApiEndpoint = CheApiClient.normalizeCheApiEndpointUrl(cheApiEndpoint)
    }

    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)

    if (!cheApiEndpoint) {
      // Try to use current server
      const currentLogin = loginManager.getCurrentLoginInfo()
      cheApiEndpoint = currentLogin.cheApiEndpoint
      if (!cheApiEndpoint) {
        // There is no current server to switch user on
        throw new Error(`Error: "--${CHE_API_ENDPOINT_KEY}" parameter is not provided`)
      }

      if (username === currentLogin.username) {
        // This is already current context
        cli.info(`Already logged in as ${username} on ${cheApiEndpoint} server`)
        return
      }
    }

    if (!username) {
      // Check if given server has only one login session to use
      const serverLogins = loginManager.getAllLogins().get(cheApiEndpoint)
      if (!serverLogins || (serverLogins && serverLogins.length < 1)) {
        cli.info(`No registered logins for ${cheApiEndpoint} server`)
        return
      }
      if (serverLogins.length !== 1) {
        throw new Error(`Username on ${cheApiEndpoint} server is expected. Please provide "--${USERNAME_KEY}" parameter`)
      }
      // Use the only logged in user on the server
      username = serverLogins[0]
    }

    await loginManager.switchLoginContext(cheApiEndpoint, username)
    cli.info(`Now active login is ${username} on ${cheApiEndpoint} server`)
  }

}
