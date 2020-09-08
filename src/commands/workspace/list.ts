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
import { CheApiClient } from '../../api/che-api'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiUrl, cheNamespace, CHE_API_URL_KEY } from '../../common-flags'

export default class List extends Command {
  static description = 'list workspaces'

  static flags = {
    help: flags.help({ char: 'h' }),
    quiet: flags.boolean({
      char: 'q',
      description: "Show workspaces ID's only",
      default: false
    }),
    chenamespace: cheNamespace,
    [CHE_API_URL_KEY]: cheApiUrl,
    [ACCESS_TOKEN_KEY]: accessToken,
  }

  async run() {
    const { flags } = this.parse(List)

    let workspaces = []
    let cheApiUrl = flags[CHE_API_URL_KEY]
    if (!cheApiUrl) {
      const kube = new KubeHelper(flags)
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`"--${CHE_API_URL_KEY}" argument is required`)
      }

      const cheHelper = new CheHelper(flags)
      cheApiUrl = await cheHelper.cheURL(flags.chenamespace) + '/api'
    }

    const cheApiClient = CheApiClient.getInstance(cheApiUrl)
    await cheApiClient.ensureCheApiUrlCorrect()

    workspaces = await cheApiClient.getAllWorkspaces(flags[ACCESS_TOKEN_KEY])

    if (flags.quiet) {
      workspaces.forEach((workspace: any) => cli.info(workspace.id))
    } else {
      this.printWorkspaces(workspaces)
    }
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
