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
import { boolean, string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as execa from 'execa'

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { CheServerLoginManager, LoginRecord } from '../../api/che-login-manager'
import { KubeHelper } from '../../api/kube'
import { cheNamespace, CHE_API_ENDPOINT_KEY } from '../../common-flags'
import { OPENSHIFT_CLI } from '../../util'

const REFRESH_TOKEN_KEY = 'refresh-token'
const LIST_LOGINS_KEY = 'list'
const CURRENT_LOGIN_KEY = 'whoami'
const SWITCH_LOGIN_KEY = 'switch'
const PASSWORD_KEY = 'password'
export const USERNAME_KEY = 'username'
export default class Login extends Command {
  static description = 'log in Eclipse Che server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    [CHE_API_ENDPOINT_KEY]: string({
      char: 's',
      description: 'Eclipse Che server API endpoint',
      env: 'CHE_API_ENDPOINT',
      required: false,
    }),
    [SWITCH_LOGIN_KEY]: boolean({
      char: 'w',
      required: false,
    }),
    [REFRESH_TOKEN_KEY]: string({
      char: 't',
      description: 'Keycloak refresh token',
      env: 'CHE_KEYCLOAK_REFRESH_TOKEN',
      required: false,
    }),
    [USERNAME_KEY]: string({
      char: 'u',
      description: 'Eclipse Che user name',
      env: 'CHE_USER_NAME',
      required: false,
    }),
    [PASSWORD_KEY]: string({
      char: 'p',
      description: 'Eclipse Che user passowrd',
      env: 'CHE_USER_PASSWORD',
      required: false,
    }),
    [LIST_LOGINS_KEY]: boolean({
      char: 'l',
      description: 'List all logins',
      required: false,
    }),
    [CURRENT_LOGIN_KEY]: boolean({
      char: 'i',
      description: 'Shows current login info',
      required: false,
    }),
  }

  async run() {
    const { flags } = this.parse(Login)

    const loginManager = await CheServerLoginManager.getInstance(this.config.configDir)

    if (flags[CURRENT_LOGIN_KEY]) {
      const currentLogin = loginManager.getCurrentLoginInfo()
      if (currentLogin.username) {
        cli.info(`Logged into ${currentLogin.cheApiEndpoint} as ${currentLogin.username}`)
      } else {
        cli.info('Not logged into any server')
      }
      return
    }

    if (flags[LIST_LOGINS_KEY]) {
      const logins = loginManager.getAllLogins()
      const currentLogin = loginManager.getCurrentLoginInfo()
      this.printLogins(logins, currentLogin)
      return
    }

    let cheApiClient: CheApiClient

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    if (!cheApiEndpoint) {
      const kube = new KubeHelper(flags)
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`Please provide server API URL using --${CHE_API_ENDPOINT_KEY} parameter`)
      }
      // Retrieve API URL from routes
      const cheHelper = new CheHelper(flags)
      cheApiEndpoint = await cheHelper.cheURL(flags.chenamespace) + '/api'
      cli.info(`Using ${cheApiEndpoint} server API URL to log in`)
      cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    } else {
      cheApiEndpoint = CheApiClient.normalizeCheApiEndpointUrl(cheApiEndpoint)
      cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
      try {
        await cheApiClient.checkCheApiEndpointUrl()
      } catch {
        // Wrong API URL, try to guess, maybe base url is provided
        cheApiEndpoint += cheApiEndpoint.endsWith('/') ? 'api' : '/api'
        cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
        await cheApiClient.checkCheApiEndpointUrl()
      }
    }

    if (!await cheApiClient.isAuthenticationEnabled()) {
      cli.info(`Authentication is not supported on the server: "${cheApiEndpoint}"`)
      return
    }

    if (flags[SWITCH_LOGIN_KEY]) {
      const username = flags[USERNAME_KEY]
      if (!username) {
        throw new Error(`Username on ${cheApiEndpoint} server is expected. Please provide "--${USERNAME_KEY}" parameter`)
      }

      await loginManager.switchLoginContext(cheApiEndpoint, username)
      cli.info(`Active login: ${username} on ${cheApiEndpoint} server`)
      return
    }

    // Try to login user
    const refreshToken = flags[REFRESH_TOKEN_KEY]
    const username = flags[USERNAME_KEY]

    let loginData: LoginRecord | undefined
    if (refreshToken) {
      loginData = { refreshToken }
    } else if (username) {
      let password = flags[PASSWORD_KEY]
      if (!password) {
        // Password wasn't provided, ask user to input it
        password = await cli.prompt(`Password for ${flags.username} on ${cheApiEndpoint}`, { type: 'hide' })
        if (!password) {
          throw new Error('Password is required')
        }
      }

      loginData = { username, password }
    } else {
      // Try to login via oc login credentials
      // Check for oc command and oc login credentials
      const stdout = (await execa(OPENSHIFT_CLI, ['status'], { timeout: 10000 })).stdout
      if (stdout.startsWith('In project')) {
        // User is logged into cluster with oc or kubectl
        // Try to retrieve oc user token
        let ocUserToken: string
        const getUserTokenArgs = ['whoami', '--show-token']
        try {
          ocUserToken = (await execa(OPENSHIFT_CLI, getUserTokenArgs, { timeout: 10000 })).stdout
        } catch {
          // Che is running on a Kubernetes cluster
          throw new Error(`No credentials provided. Please provide "--${REFRESH_TOKEN_KEY}" or "--${USERNAME_KEY}" parameter`)
        }

        const kube = new KubeHelper()
        const subjectIssuer = (await kube.isOpenShift4()) ? 'openshift-v4' : 'openshift-v3'

        loginData = { subjectToken: ocUserToken, subjectIssuer }
      }
    }

    if (!loginData) {
      throw new Error('Login data is required. Please provide token or username and password.')
    }

    try {
      const username = await loginManager.setLoginContext(cheApiEndpoint, loginData)
      cli.info(`Succesfully logged into ${cheApiEndpoint} as ${username}`)
    } catch (error) {
      cli.error(error)
    }
  }

  private printLogins(allLogins: Map<string, string[]>, currentLogin: { cheApiEndpoint: string, username: string }): void {
    const currentLoginMarker = ' * '
    const indent = '   '

    let output: string
    if (allLogins.size > 0) {
      output = 'Available logins:\n'
      allLogins.forEach((serverLogins: string[], serverUrl: string) => {
        output += indent + serverUrl + '\n'
        for (const login of serverLogins) {
          output += (currentLogin.cheApiEndpoint === serverUrl && currentLogin.username === login) ? currentLoginMarker : indent
          output += indent + login + '\n'
        }
      })
    } else {
      output = 'No registered logins'
    }

    cli.info(output)
  }

}
