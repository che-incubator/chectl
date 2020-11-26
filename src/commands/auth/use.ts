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
import * as inquirer from 'inquirer'

import { CheApiClient } from '../../api/che-api-client'
import { CheServerLoginManager } from '../../api/che-login-manager'
import { CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, username, USERNAME_KEY } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'

export default class Use extends Command {
  static description = 'Set active login session'

  static args = [
    {
      name: CHE_API_ENDPOINT_KEY,
      description: 'Eclipse Che server API endpoint',
      required: false
    }
  ]
  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [USERNAME_KEY]: username,
    interactive: flags.boolean({
      char: 'i',
      description: 'Select an active login session in interactive mode',
      required: false,
      exclusive: [USERNAME_KEY]
    }),
    telemetry: CHE_TELEMETRY
  }

  static examples = [
    '# Set an active login session for the specified user on the given cluster:\n' +
    'chectl auth:use che-che.apps-crc.testing/api -u username',
    '\n\n# Switch to another user on the same cluster:\n' +
    'chectl auth:use -u another-user-on-this-server',
    '\n\n# Switch to the only user on the given cluster:\n' +
    'chectl auth:use my.cluster.net',
    '\n\n# Select an active login session in interactive mode:\n' +
    'chectl auth:use -i',
  ]

  async run() {
    const { args, flags } = this.parse(Use)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Use.id, flags })

    if (flags.interactive) {
      await this.interactiveSwitch()
      return
    }

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
        throw new Error('No current login session. Please specify it directly.')
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
          cli.info(`No registered login sessions on server ${cheApiEndpoint}`)
          return
        }
        cheApiEndpoint = cheApiEndpointGuess
      }
    }

    if (!username) {
      // Check if given server has only one login session to use
      const serverLogins = loginManager.getAllLogins().get(cheApiEndpoint)
      if (!serverLogins || (serverLogins && serverLogins.length < 1)) {
        cli.info(`No registered login sessions for ${cheApiEndpoint} server`)
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

  private async interactiveSwitch(): Promise<void> {
    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)
    const allLogins = loginManager.getAllLogins()
    const currentLogin = loginManager.getCurrentLoginInfo()

    let cheApiEndpoint = ''
    let username = ''
    if (allLogins.size === 0) {
      cli.info('No login session exists')
      return
    } else if (allLogins.size === 1) {
      // Retrieve the only login info
      cheApiEndpoint = allLogins.keys().next().value
      username = allLogins.get(cheApiEndpoint)![0]
    } else {
      // Ask user to interactively select
      const choices: inquirer.Answers[] = []
      let current: inquirer.Answers | undefined
      allLogins.forEach((serverLogins: string[], serverUrl: string) => {
        choices.push(new inquirer.Separator(serverUrl))
        for (const login of serverLogins) {
          const choise = {
            name: `   ${login}`,
            value: { cheApiEndpoint: serverUrl, username: login }
          }
          choices.push(choise)
          if (currentLogin.cheApiEndpoint === serverUrl && currentLogin.username === login) {
            current = choise
          }
        }
      })

      const userResponse = await inquirer.prompt([{
        name: 'context',
        type: 'list',
        message: 'Select login session',
        choices,
        default: current ? current.value : undefined,
      }])

      if (userResponse && userResponse.context) {
        cheApiEndpoint = userResponse.context.cheApiEndpoint
        username = userResponse.context.username
      }
    }

    if (cheApiEndpoint && username) {
      if (currentLogin.cheApiEndpoint === cheApiEndpoint && currentLogin.username === username) {
        cli.info(`Already logged in as ${username} on ${cheApiEndpoint} server`)
        return
      }
      await loginManager.switchLoginContext(cheApiEndpoint, username)
      cli.info(`Now active login is ${username} on ${cheApiEndpoint} server`)
    } else {
      cli.info('Nothing to change')
    }
  }

}
