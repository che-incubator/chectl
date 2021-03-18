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
import * as execa from 'execa'

import { CheApiClient } from '../../api/che-api-client'
import { CheServerLoginManager, getCheApiEndpoint, LoginRecord } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, username, USERNAME_KEY } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_NAMESPACE } from '../../constants'
import { getCommandErrorMessage, OPENSHIFT_CLI } from '../../util'

const REFRESH_TOKEN_KEY = 'refresh-token'
const PASSWORD_KEY = 'password'

export default class Login extends Command {
  static description = 'Log in to Eclipse Che server'

  static args = [
    {
      name: CHE_API_ENDPOINT_KEY,
      description: 'Eclipse Che server API endpoint',
      env: 'CHE_API_ENDPOINT',
      required: false // In case of login via oc token with admin rights
    }
  ]
  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    [REFRESH_TOKEN_KEY]: string({
      char: 't',
      description: 'Keycloak refresh token',
      env: 'CHE_KEYCLOAK_REFRESH_TOKEN',
      required: false,
      exclusive: [USERNAME_KEY, PASSWORD_KEY]
    }),
    [USERNAME_KEY]: username,
    [PASSWORD_KEY]: string({
      char: 'p',
      description: 'Eclipse Che user password',
      env: 'CHE_USER_PASSWORD',
      required: false,
      exclusive: [REFRESH_TOKEN_KEY]
    }),
    telemetry: CHE_TELEMETRY
  }

  static examples = [
    '# Log in with username and password (when OpenShift OAuth is not enabled):\n' +
    'chectl auth:login https://che-che.apps-crc.testing/api -u username -p password',
    '\n\n# Log in with username and password (password will be asked interactively):\n' +
    'chectl auth:login che-che.apps-crc.testing -u username',
    '\n\n# Log in with token (when OpenShift OAuth is enabled):\n' +
    'chectl auth:login che.openshift.io -t token',
    '\n\n# Log in with oc token (when logged into an OpenShift cluster with oc and OpenShift OAuth is enabled):\n' +
    'chectl auth:login che.my.server.net',
  ]

  async run() {
    const { args, flags } = this.parse(Login)
    flags.chenamespace = flags.chenamespace || DEFAULT_CHE_NAMESPACE
    await ChectlContext.init(flags, this)

    // Not recommended to track user and password in telemetry
    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Login.id, flags })

    const loginManager = await CheServerLoginManager.getInstance()

    let cheApiClient: CheApiClient
    let cheApiEndpoint: string | undefined = args[CHE_API_ENDPOINT_KEY]
    if (!cheApiEndpoint) {
      cheApiEndpoint = await getCheApiEndpoint(flags)
      cli.info(`Using ${cheApiEndpoint} server API URL to log in`)
      cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    } else {
      cheApiEndpoint = CheApiClient.normalizeCheApiEndpointUrl(cheApiEndpoint)
      cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
      try {
        await cheApiClient.checkCheApiEndpointUrl()
      } catch (error) {
        // Wrong API URL, try to guess, maybe base url is provided
        if (!cheApiEndpoint.endsWith('api')) {
          cheApiEndpoint += '/api'
          cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
          await cheApiClient.checkCheApiEndpointUrl()
        } else {
          throw error
        }
      }
    }

    if (!await cheApiClient.isAuthenticationEnabled()) {
      cli.info(`Authentication is not supported on the server: "${cheApiEndpoint}"`)
      return
    }

    // Try to login user
    const refreshToken: string | undefined = flags[REFRESH_TOKEN_KEY]
    const username: string | undefined = flags[USERNAME_KEY]

    let loginData: LoginRecord | undefined
    if (refreshToken) {
      loginData = { refreshToken, expires: Date.now() / 1000 + 60 }
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
      const kube = new KubeHelper(flags)

      // User is logged into cluster with oc or kubectl
      // Try to retrieve oc user token
      if (await kube.isOpenShift()) {
        let ocUserToken: string
        const getUserTokenArgs = ['whoami', '--show-token']
        try {
          ocUserToken = (await execa(OPENSHIFT_CLI, getUserTokenArgs, { timeout: 10000 })).stdout
        } catch {
          // Che is running on a Kubernetes cluster
          throw new Error(`No credentials provided. Please provide "--${REFRESH_TOKEN_KEY}" or "--${USERNAME_KEY}" parameter`)
        }

        const subjectIssuer = (await kube.isOpenShift4()) ? 'openshift-v4' : 'openshift-v3'

        loginData = { subjectToken: ocUserToken, subjectIssuer }
      } else {
        const username = await cli.prompt(`Username on ${cheApiEndpoint}`)
        if (!username) {
          throw new Error('Username is required')
        }
        const password = await cli.prompt(`Password for ${username} on ${cheApiEndpoint}`, { type: 'hide' })
        if (!password) {
          throw new Error('Password is required')
        }
        loginData = { username, password }
      }
    }

    if (!loginData) {
      throw new Error('Login data is required. Please provide token or username and password.')
    }

    try {
      const username = await loginManager.setLoginContext(cheApiEndpoint, loginData)
      cli.info(`Successfully logged into ${cheApiEndpoint} as ${username}`)
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }
  }
}
