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
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'

import { CheHelper } from '../../api/che'
import { CheServerLoginManager } from '../../api/che-login-manager'
import { KubeHelper } from '../../api/kube'
import { cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY } from '../../common-flags'

import { USERNAME_KEY } from './login'

export default class Logout extends Command {
  static description = 'log out of Eclipse Che server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [USERNAME_KEY]: string({
      char: 'u',
      description: 'Eclipse Che user name',
      env: 'CHE_USER_NAME',
      required: false,
    }),
  }

  async run() {
    const { flags } = this.parse(Logout)

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    let username = flags[USERNAME_KEY]

    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)

    if (!cheApiEndpoint && !username) {
      // Logout from current Che server
      const currentLogin = loginManager.getCurrentLoginInfo()
      if (currentLogin.cheApiEndpoint && currentLogin.username) {
        cheApiEndpoint = currentLogin.cheApiEndpoint
        username = currentLogin.username
      } else {
        cli.info('Not currently logged in')
        return
      }
    } else {
      if (!cheApiEndpoint) {
        // Try to get current Che server API URL
        const kube = new KubeHelper(flags)
        if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
          throw new Error(`Please provide server API URL using --${CHE_API_ENDPOINT_KEY} parameter`)
        }
        const cheHelper = new CheHelper(flags)
        cheApiEndpoint = await cheHelper.cheURL(flags.chenamespace) + '/api'
      }

      if (username) {
        if (!loginManager.hasLoginFor(cheApiEndpoint, username)) {
          cli.info(`No existing logins for ${username} on server ${cheApiEndpoint}`)
          return
        }
      }
    }

    loginManager.deleteLoginContext(cheApiEndpoint, username)
    if (username) {
      cli.info(`Succesfully logged out ${username} on ${cheApiEndpoint}`)
    } else {
      cli.info(`Succesfully logged out of ${cheApiEndpoint}`)
    }
  }

}
