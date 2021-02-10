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
import { ChectlContext } from '../../api/context'
import { CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, username, USERNAME_KEY } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'

export default class Delete extends Command {
  static description = 'Delete specified login session(s)'

  static args = [
    {
      name: CHE_API_ENDPOINT_KEY,
      description: 'Eclipse Che server API endpoint',
      required: true
    }
  ]
  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [USERNAME_KEY]: username,
    telemetry: CHE_TELEMETRY
  }

  static examples = [
    '# Delete login session of the specified user on the cluster:\n' +
    'chectl auth:delete che-che.apps-crc.testing/api -u username',
    '\n\n# Delete all login sessions on the cluster:\n' +
    'chectl auth:delete che-che.apps-crc.testing',
  ]

  async run() {
    const { args, flags } = this.parse(Delete)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })
    let cheApiEndpoint = CheApiClient.normalizeCheApiEndpointUrl(args[CHE_API_ENDPOINT_KEY])
    const username: string | undefined = flags[USERNAME_KEY]

    const loginManager = await CheServerLoginManager.getInstance()

    if (!loginManager.hasLoginFor(cheApiEndpoint)) {
      // Maybe /api suffix isn't provided
      const cheApiEndpointGuess = cheApiEndpoint + '/api'
      if (!loginManager.hasLoginFor(cheApiEndpointGuess)) {
        cli.info(`No registered login sessions on server ${cheApiEndpoint}`)
        return
      }
      cheApiEndpoint = cheApiEndpointGuess
    }

    if (username) {
      if (!loginManager.hasLoginFor(cheApiEndpoint, username)) {
        cli.info(`${username} is not logged in on ${cheApiEndpoint}. Nothing to delete.`)
        return
      }
    }

    loginManager.deleteLoginContext(cheApiEndpoint, username)
    if (username) {
      cli.info(`Successfully logged out ${username} on ${cheApiEndpoint}`)
    } else {
      cli.info(`Successfully logged out all users on ${cheApiEndpoint}`)
    }
  }

}
