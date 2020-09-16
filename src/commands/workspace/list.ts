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

    let workspaces = []
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

    workspaces = await cheApiClient.getAllWorkspaces(flags[ACCESS_TOKEN_KEY])

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
