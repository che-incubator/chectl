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
import * as Listr from 'listr'
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { accessToken, cheNamespace } from '../../common-flags'
export default class Create extends Command {
  static description = 'Creates a workspace from a devfile'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    devfile: string({
      char: 'f',
      description: 'path or URL to a valid devfile',
      env: 'DEVFILE_PATH',
      required: false,
    }),
    name: string({
      description: 'workspace name: overrides the workspace name to use instead of the one defined in the devfile.',
      required: false,
    }),
    start: boolean({
      char: 's',
      description: 'Starts the workspace after creation',
      default: false
    }),
    'access-token': accessToken
  }

  async run() {
    const { flags } = this.parse(Create)

    const tasks = this.getWorkspaceCreateTasks(flags)
    try {
      let ctx = await tasks.run()
      this.log('\nWorkspace IDE URL:')
      cli.url(ctx.workspaceIdeURL, ctx.workspaceIdeURL)
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command workspace:create has completed successfully.'
    })

    this.exit(0)
  }

  getWorkspaceCreateTasks(flags: any): Listr<any> {
    const che = new CheHelper(flags)
    return new Listr([
      {
        title: 'Retrieving Eclipse Che server URL',
        task: async (ctx: any, task: any) => {
          ctx.cheURL = await che.cheURL(flags.chenamespace)
          task.title = await `${task.title}... ${ctx.cheURL}`
        }
      },
      {
        title: 'Verify if Eclipse Che server is running',
        task: async (ctx: any, task: any) => {
          if (!await che.isCheServerReady(ctx.cheURL)) {
            this.error(`E_SRV_NOT_RUNNING - Eclipse Che server is not available by ${ctx.cheURL}`, { code: 'E_SRV_NOT_RUNNNG' })
          }
          const status = await che.getCheServerStatus(ctx.cheURL)
          ctx.isAuthEnabled = await che.isAuthenticationEnabled(ctx.cheURL)
          const auth = ctx.isAuthEnabled ? '(auth enabled)' : '(auth disabled)'
          task.title = await `${task.title}...${status} ${auth}`
        }
      },
      {
        title: `Create workspace from Devfile ${flags.devfile}`,
        task: async (ctx: any) => {
          if (ctx.isAuthEnabled && !flags['access-token']) {
            this.error('E_AUTH_REQUIRED - Eclipse Che authentication is enabled and an access token needs to be provided (flag --access-token).')
          }

          let devfilePath: string
          if (flags.devfile) {
            devfilePath = flags.devfile
          } else if (fs.existsSync('devfile.yaml')) {
            devfilePath = 'devfile.yaml'
          } else if (fs.existsSync('devfile.yml')) {
            devfilePath = 'devfile.yml'
          } else {
            throw new Error("E_DEVFILE_MISSING - Devfile wasn't specified via '-f' option and \'devfile.yaml' is not present in current directory.")
          }

          const workspaceConfig = await che.createWorkspaceFromDevfile(flags.chenamespace, devfilePath, flags.name, flags['access-token'])
          ctx.workspaceId = workspaceConfig.id
          if (workspaceConfig.links && workspaceConfig.links.ide) {
            ctx.workspaceIdeURL = await che.buildDashboardURL(workspaceConfig.links.ide)
          }
        }
      }, {
        title: 'Start workspace',
        enabled: () => flags.start,
        task: async (ctx: any, task: any) => {
          await che.startWorkspace(flags.chenamespace, ctx.workspaceId, flags['access-token'])
          task.title = `${task.title}... Done`
        }
      }
    ], { renderer: 'silent' })

  }

}
