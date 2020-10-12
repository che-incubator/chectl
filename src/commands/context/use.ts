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
import { username, USERNAME_KEY, CHE_API_ENDPOINT_KEY } from '../../common-flags'

export default class Use extends Command {
  static description = 'set current login contex'

  static args = [
    {
      name: CHE_API_ENDPOINT_KEY,
      description: 'Eclipse Che server API endpoint',
      env: 'CHE_API_ENDPOINT',
      required: false
    }
  ]
  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [USERNAME_KEY]: username,
  }

  static examples = [
    'context:use che-che.apps-crc.testing/api -u <username>',
    'context:use -u <another-user-on-this-server>',
  ]

  async run() {
    const { args, flags } = this.parse(Use)

    let cheApiEndpoint: string | undefined = args[CHE_API_ENDPOINT_KEY]
    let username: string | undefined = flags[USERNAME_KEY]

    if (!cheApiEndpoint && !username) {
      throw new Error('No arguments provided')
    }

    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)

    if (!cheApiEndpoint) {
      // Try to use current server
      const currentLogin = loginManager.getCurrentLoginInfo()
      cheApiEndpoint = currentLogin.cheApiEndpoint
      if (!cheApiEndpoint) {
        // There is no current server to switch user on
        throw new Error('No current login context. Please specify it directly.')
      }

      if (username === currentLogin.username) {
        // This is already current context
        cli.info(`Already logged in as ${username} on ${cheApiEndpoint} server`)
        return
      }
    } else {
      cheApiEndpoint = CheApiClient.normalizeCheApiEndpointUrl(cheApiEndpoint)
      // Check if any login exist for provided Che server
      if (!loginManager.hasLoginFor(cheApiEndpoint)) {
        // Maybe /api suffix isn't provided
        const cheApiEndpointGuess = cheApiEndpoint + '/api'
        if (!loginManager.hasLoginFor(cheApiEndpointGuess)) {
          cli.info(`No registered logins on server ${cheApiEndpoint}`)
          return
        }
        cheApiEndpoint = cheApiEndpointGuess
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
