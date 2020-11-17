/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { cli } from 'cli-ux'
import * as notifier from 'node-notifier'

import { CheApiClient } from '../../api/che-api-client'
import { getLoginData } from '../../api/che-login-manager'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, skipKubeHealthzCheck } from '../../common-flags'

export default class Stop extends Command {
  static description = 'Stop a running workspace'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    chenamespace: cheNamespace,
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to stop',
      required: true
    }
  ]

  async run() {
    const { flags } = this.parse(Stop)
    const { args } = this.parse(Stop)

    await this.config.runHook('analytics', { event: Stop.description, command: Stop.id, flags })

    const workspaceId = args.workspace
    const { cheApiEndpoint, accessToken } = await getLoginData(this.config.configDir, flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY])
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.stopWorkspace(workspaceId, accessToken)
    cli.log('Workspace successfully stopped.')

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:stop has completed successfully.'
    })

    this.exit(0)
  }
}
