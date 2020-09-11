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

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, skipKubeHealthzCheck } from '../../common-flags'

export default class Stop extends Command {
  static description = 'Stop a running workspace'

  static flags = {
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

    const workspaceId = args.workspace

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    if (!cheApiEndpoint) {
      const kube = new KubeHelper(flags)
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`Eclipse Che API endpoint is required. Use flag --${CHE_API_ENDPOINT_KEY} to provide it.`)
      }

      const cheHelper = new CheHelper(flags)
      cheApiEndpoint = await cheHelper.cheURL(flags.chenamespace) + '/api'
    }

    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.checkCheApiEndpointUrl()

    await cheApiClient.stopWorkspace(workspaceId, flags[ACCESS_TOKEN_KEY])
    cli.log('Workspace successfully stopped.')

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:stop has completed successfully.'
    })

    this.exit(0)
  }
}
