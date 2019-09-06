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
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'

import { CheHelper } from '../../api/che'
import { accessToken, cheNamespace, listrRenderer } from '../../common-flags'

export default class Start extends Command {
  static description = 'create and start a Che workspace'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    devfile: string({
      char: 'f',
      description: 'path or URL to a valid devfile',
      env: 'DEVFILE_PATH',
      required: false,
    }),
    workspaceconfig: string({
      char: 'w',
      description: 'path to a valid workspace configuration json file',
      env: 'WORKSPACE_CONFIG_JSON_PATH',
      required: false,
    }),
    name: string({
      description: 'workspace name: overrides the workspace name to use instead of the one defined in the devfile. Works only for devfile',
      required: false,
    }),
    'access-token': accessToken,
    'listr-renderer': listrRenderer
  }

  async checkToken(flags: any, ctx: any) {
    if (ctx.isAuthEnabled && !flags['access-token']) {
      this.error('E_AUTH_REQUIRED - Che authentication is enabled and an access token need to be provided (flag --access-token).')
    }
  }

  async run() {
    const { flags } = this.parse(Start)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper(flags)
    if (!flags.devfile && !flags.workspaceconfig) {
      this.error('workspace:start command is expecting a devfile or workspace configuration parameter.')
    }
    const tasks = new Listr([
      {
        title: 'Retrieving Che Server URL',
        task: async (ctx: any, task: any) => {
          ctx.cheURL = await che.cheURL(flags.chenamespace)
          task.title = await `${task.title}...${ctx.cheURL}`
        }
      },
      {
        title: 'Verify if Che server is running',
        task: async (ctx: any, task: any) => {
          if (!await che.isCheServerReady(ctx.cheURL)) {
            this.error(`E_SRV_NOT_RUNNING - Che Server is not available by ${ctx.cheURL}`, { code: 'E_SRV_NOT_RUNNNG' })
          }
          const status = await che.getCheServerStatus(ctx.cheURL)
          ctx.isAuthEnabled = await che.isAuthenticationEnabled(ctx.cheURL)
          const auth = ctx.isAuthEnabled ? '(auth enabled)' : '(auth disabled)'
          task.title = await `${task.title}...${status} ${auth}`
        }
      },
      {
        title: `Create workspace from Devfile ${flags.devfile}`,
        enabled: () => flags.devfile !== undefined,
        task: async (ctx: any) => {
          await this.checkToken(flags, ctx)
          ctx.workspaceIdeURL = await che.createWorkspaceFromDevfile(flags.chenamespace, flags.devfile, flags.name, flags['access-token'])
        }
      },
      {
        title: `Create workspace from Workspace Config ${flags.workspaceconfig}`,
        enabled: () => flags.workspaceconfig !== undefined,
        task: async (ctx: any) => {
          await this.checkToken(flags, ctx)
          ctx.workspaceIdeURL = await che.createWorkspaceFromWorkspaceConfig(flags.chenamespace, flags.workspaceconfig, flags['access-token'])
        }
      },
    ], { renderer: flags['listr-renderer'] as any })

    try {
      let ctx = await tasks.run()
      this.log('\nWorkspace IDE URL:')
      cli.url(ctx.workspaceIdeURL, ctx.workspaceIdeURL)
      this.log('\n')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:start has completed successfully.'
    })
  }
}
