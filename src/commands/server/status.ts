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
import { safeDump } from 'js-yaml'
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY as CHE_API_ENDPOINT_KEY, skipKubeHealthzCheck } from '../../common-flags'

export default class List extends Command {
  static description = 'list workspaces'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  async run() {
    const { flags } = this.parse(List)
    const cheHelper = new CheHelper(flags)
    const kube = new KubeHelper(flags)

    let workspaces = []
    let isOpenshiftOauthEnabled = false

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    if (!cheApiEndpoint) {
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`Eclipse Che API endpoint is required. Use flag --${CHE_API_ENDPOINT_KEY} to provide it.`)
      }
      cheApiEndpoint = await cheHelper.cheURL(flags.chenamespace) + '/api'
    }

    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.checkCheApiEndpointUrl()

    workspaces = await cheApiClient.getAllWorkspaces(flags[ACCESS_TOKEN_KEY])
    let workspacesRunning = workspaces.filter(wks => wks.status === 'RUNNING')

    const cheServerVersion = await cheApiClient.getCheServerVersion(flags[ACCESS_TOKEN_KEY])
    const cheUrl = await cheHelper.cheURL(flags.chenamespace)

    if (await kube.isOpenShift()) {
      const providers = await kube.getOpenshiftAuthProviders()
      if (!providers || providers.length === 0) {
        isOpenshiftOauthEnabled = false
      } else {
        isOpenshiftOauthEnabled = true
      }
    }

    cli.log(`Version                 : ${cheServerVersion}`)
    cli.log(`Eclipse Che Url         : ${cheUrl}`)
    cli.log(`Workspaces              : ${workspaces.length} (${workspacesRunning.length} running)`)
    cli.log(`OpenShift OAuth enabled : ${isOpenshiftOauthEnabled}`)

    notifier.notify({
      title: 'chectl',
      message: 'Command server:status has completed successfully.'
    })
  }
}
