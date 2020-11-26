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
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'

export default class Delete extends Command {
  static description = 'Delete a stopped workspace - use workspace:stop to stop the workspace before deleting it'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'delete-namespace': flags.boolean({
      description: 'Indicates that a Kubernetes namespace where workspace was created will be deleted as well',
      default: false
    }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY
  }
  static args = [
    {
      name: 'workspace',
      description: 'The workspace id to delete',
      required: true
    }
  ]

  async run() {
    const { flags, args } = this.parse(Delete)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })

    const workspaceId = args.workspace
    const { cheApiEndpoint, accessToken } = await getLoginData(this.config.configDir, flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY], flags)
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.deleteWorkspaceById(workspaceId, accessToken)
    cli.log(`Workspace with id '${workspaceId}' deleted.`)

    if (flags['delete-namespace']) {
      const workspace = await cheApiClient.getWorkspaceById(workspaceId, accessToken)
      const infrastructureNamespace = workspace!.attributes!.infrastructureNamespace

      if (infrastructureNamespace === flags.chenamespace) {
        cli.warn(`It is not possible to delete namespace '${infrastructureNamespace}' since it is used for Eclipse Che deployment.`)
        return
      }

      const kube = new KubeHelper(flags)
      if (await kube.namespaceExist(infrastructureNamespace)) {
        try {
          await kube.deleteNamespace(infrastructureNamespace)
          cli.log(`Namespace '${infrastructureNamespace}' deleted.`)
        } catch (error) {
          cli.warn(`Failed to delete namespace '${infrastructureNamespace}'. Reason: ${error.message}`)
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
