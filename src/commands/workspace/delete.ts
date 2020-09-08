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
import { CheApiClient } from '../../api/che-api'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiUrl, cheNamespace, CHE_API_URL_KEY } from '../../common-flags'

export default class Delete extends Command {
  static description = 'delete a stopped workspace - use workspace:stop to stop the workspace before deleting it'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'delete-namespace': flags.boolean({
      description: 'Indicates that a Kubernetes namespace where workspace was created will be deleted as well',
      default: false
    }),
    [CHE_API_URL_KEY]: cheApiUrl,
    [ACCESS_TOKEN_KEY]: accessToken,
  }
  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to delete',
      required: true
    }
  ]

  async run() {
    const { flags } = this.parse(Delete)
    const { args } = this.parse(Delete)

    const workspaceId = args.workspace

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

    const workspace = await cheApiClient.getWorkspaceById(workspaceId, flags[ACCESS_TOKEN_KEY])
    const infrastructureNamespace = workspace!.attributes!.infrastructureNamespace

    await cheApiClient.deleteWorkspaceById(workspaceId, flags[ACCESS_TOKEN_KEY])
    cli.log(`Workspace with id '${workspaceId}' deleted.`)

    if (flags['delete-namespace']) {
      if (infrastructureNamespace === flags.chenamespace) {
        cli.warn(`It is not possible to delete namespace '${infrastructureNamespace}' since it is used for Eclipse Che deployment.`)
        return
      }

      const kube = new KubeHelper(flags)
      if (await kube.namespaceExist(infrastructureNamespace)) {
        if (await kube.deleteNamespace(infrastructureNamespace)) {
          cli.log(`Namespace '${infrastructureNamespace}' deleted.`)
        } else {
          cli.warn(`It is not possible to delete namespace '${infrastructureNamespace}' because current user doesn't have required permissions.`)
        }
      }
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:delete has completed successfully.'
    })

    this.exit(0)
  }
}
