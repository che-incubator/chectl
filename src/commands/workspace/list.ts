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

import { CheApiClient } from '../../api/che-api-client'
import { getLoginData } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { findWorkingNamespace } from '../../util'

export default class List extends Command {
  static description = 'List workspaces'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY
  }

  async run() {
    const { flags } = this.parse(List)
    flags.chenamespace = await findWorkingNamespace(flags)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: List.id, flags })
    const { cheApiEndpoint, accessToken } = await getLoginData(flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY], flags)
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    const workspaces = await cheApiClient.getAllWorkspaces(accessToken)

    this.printWorkspaces(workspaces)
  }

  private printWorkspaces(workspaces: any[]): void {
    const data: any[] = []
    workspaces.forEach((workspace: any) => {
      data.push({
        id: workspace.id,
        name: workspace.devfile.metadata.name,
        namespace: workspace.attributes.infrastructureNamespace,
        status: workspace.status,
        created: new Date(parseInt(workspace.attributes.created, 10)).toISOString(),
        updated: workspace.attributes.updated ? new Date(parseInt(workspace.attributes.updated, 10)).toISOString() : ''
      })
    })
    cli.table(data, { id: {}, name: {}, namespace: {}, status: {}, created: {}, updated: {} })
  }
}
