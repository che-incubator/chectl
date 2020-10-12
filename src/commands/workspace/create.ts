/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { boolean, string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as fs from 'fs'
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { KubeHelper } from '../../api/kube'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, skipKubeHealthzCheck } from '../../common-flags'

export default class Create extends Command {
  static description = 'Creates a workspace from a devfile'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    devfile: string({
      char: 'f',
      description: 'Path or URL to a valid devfile',
      env: 'DEVFILE_PATH',
      required: false,
    }),
    name: string({
      description: 'Workspace name: overrides the workspace name to use instead of the one defined in the devfile.',
      required: false,
    }),
    start: boolean({
      char: 's',
      description: 'Starts the workspace after creation',
      default: false
    }),
    debug: boolean({
      char: 'd',
      description: 'Debug workspace start. It is useful when workspace start fails and it is needed to print more logs on startup. This flag is used in conjunction with --start flag.',
      default: false
    }),
    [CHE_API_ENDPOINT_KEY]: cheApiEndpoint,
    [ACCESS_TOKEN_KEY]: accessToken,
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  async run() {
    const { flags } = this.parse(Create)

    const devfilePath = this.getDevfilePath(flags.devfile)
    const accessToken = flags[ACCESS_TOKEN_KEY]
    const cheHelper = new CheHelper(flags)

    let cheApiEndpoint = flags[CHE_API_ENDPOINT_KEY]
    if (!cheApiEndpoint) {
      const kube = new KubeHelper(flags)
      if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
        throw new Error(`Eclipse Che API endpoint is required. Use flag --${CHE_API_ENDPOINT_KEY} to provide it.`)
      }
      cheApiEndpoint = await cheHelper.cheURL(flags.chenamespace) + '/api'
    }

    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.checkCheApiEndpointUrl()

    let workspace = await cheHelper.createWorkspaceFromDevfile(cheApiEndpoint, devfilePath, flags.name, accessToken)
    const workspaceId = workspace.id!

    if (flags.start) {
      await cheApiClient.startWorkspace(workspaceId, flags.debug, accessToken)
      this.log('Workspace has been successfully created and workspace start request has been sent.')
      this.log('Workspace will be available shortly:')
    } else {
      this.log('Workspace has been successfully created:')
    }
    workspace = await cheApiClient.getWorkspaceById(workspaceId, accessToken)
    if (workspace.links && workspace.links.ide) {
      const workspaceIdeURL = await cheHelper.buildDashboardURL(workspace.links.ide)
      cli.url(workspaceIdeURL, workspaceIdeURL)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:create has completed successfully.'
    })

    this.exit(0)
  }

  private getDevfilePath(devfilePath?: string) {
    if (!devfilePath) {
      if (fs.existsSync('devfile.yaml')) {
        devfilePath = 'devfile.yaml'
      } else if (fs.existsSync('devfile.yml')) {
        devfilePath = 'devfile.yml'
      } else {
        throw new Error("E_DEVFILE_MISSING - Devfile wasn't specified via '-f' option and 'devfile.yaml' is not present in current directory.")
      }
    }
    return devfilePath
  }

}
