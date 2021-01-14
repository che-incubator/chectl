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

import { CheHelper } from '../../api/che'
import { CheApiClient } from '../../api/che-api-client'
import { getLoginData } from '../../api/che-login-manager'
import { ChectlContext } from '../../api/context'
import { accessToken, ACCESS_TOKEN_KEY, cheApiEndpoint, cheNamespace, CHE_API_ENDPOINT_KEY, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { findWorkingNamespace } from '../../util'

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
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY
  }

  async run() {
    const { flags } = this.parse(Create)
    flags.chenamespace = await findWorkingNamespace(flags)
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Create.id, flags })

    const devfilePath = this.getDevfilePath(flags.devfile)
    const cheHelper = new CheHelper(flags)

    const { cheApiEndpoint, accessToken } = await getLoginData(flags[CHE_API_ENDPOINT_KEY], flags[ACCESS_TOKEN_KEY], flags)
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)

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
