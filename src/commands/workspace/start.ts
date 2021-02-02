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

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { getLoginData } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { findWorkingNamespace } from '../../util'

export default class Start extends Command {
  static description = 'Starts a workspace'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    debug: flags.boolean({
      char: 'd',
      description: 'Debug workspace start. It is useful when workspace start fails and it is needed to print more logs on startup.',
      default: false
    }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    chenamespace: cheNamespace,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY
  }

  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to start',
      required: true
    }
  ]

  async run() {
    const { flags, args } = this.parse(Start)
    flags.chenamespace = await findWorkingNamespace(flags)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Start.id, flags })

    const workspaceId = args.workspace
    const cheHelper = new CheHelper(flags)

    const { cheApiEndpoint, accessToken } = await getLoginData(flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY], flags)
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.startWorkspace(workspaceId, flags.debug, accessToken)

    const workspace = await cheApiClient.getWorkspaceById(workspaceId, accessToken)
    if (workspace.links && workspace.links.ide) {
      const workspaceIdeURL = await cheHelper.buildDashboardURL(workspace.links.ide)
      cli.log('Workspace start request has been sent, workspace will be available shortly:')
      cli.url(workspaceIdeURL, workspaceIdeURL)
    } else {
      cli.log('Workspace start request has been sent, workspace will be available shortly.')
    }

    this.exit(0)
  }
}
