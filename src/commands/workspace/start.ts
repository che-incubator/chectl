/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import Command, { flags } from '@oclif/command'
import { cli } from 'cli-ux'
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiUrl, cheNamespace, CHE_API_URL_KEY } from '../../common-flags'

export default class Start extends Command {
  static description = 'Starts a workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    debug: flags.boolean({
      char: 'd',
      description: 'Debug workspace start. It is useful when workspace start fails and it is needed to print more logs on startup.',
      default: false
    }),
    [CHE_API_URL_KEY]: cheApiUrl,
    [ACCESS_TOKEN_KEY]: accessToken,
    chenamespace: cheNamespace,
  }

  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to start',
      required: true
    }
  ]

  async run() {
    const { flags } = this.parse(Start)
    const { args } = this.parse(Start)

    const workspaceId = args.workspace
    const cheHelper = new CheHelper(flags)

    let cheApiUrl = flags[CHE_API_URL_KEY]
    if (!cheApiUrl) {
      const kube = new KubeHelper(flags)
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`"--${CHE_API_URL_KEY}" argument is required`)
      }
      cheApiUrl = await cheHelper.cheURL(flags.chenamespace) + '/api'
    }

    const cheApiClient = CheApiClient.getInstance(cheApiUrl)
    await cheApiClient.ensureCheApiUrlCorrect()

    await cheApiClient.startWorkspace(workspaceId, flags.debug, flags[ACCESS_TOKEN_KEY])

    const workspace = await cheApiClient.getWorkspaceById(workspaceId, flags[ACCESS_TOKEN_KEY])
    if (workspace.links && workspace.links.ide) {
      const workspaceIdeURL = await cheHelper.buildDashboardURL(workspace.links.ide)
      cli.log('Workspace start request has been sent, workspace will be available shortly:')
      cli.url(workspaceIdeURL, workspaceIdeURL)
    } else {
      cli.log('Workspace start request has been sent, workspace will be available shortly.')
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:start has completed successfully.'
    })

    this.exit(0)
  }
}
