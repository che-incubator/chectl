/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as fs from 'fs'
import Listr = require('listr')

import { CheHelper } from '../api/che'

export class WorkspaceTasks {
  cheHelper: CheHelper
  cheNamespace: string
  accessToken: string
  constructor(flags: any) {
    this.cheHelper = new CheHelper(flags)
    this.cheNamespace = flags.chenamespace
    this.accessToken = flags['access-token']
  }

  getWorkspaceStartTask(debug: boolean): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Start the workspace',
        task: async (ctx: any, task: any) => {
          await this.cheHelper.startWorkspace(this.cheNamespace, ctx.workspaceId, debug, this.accessToken)
          task.title = `${task.title}... Done`
        }
      }
    ]
  }

  getWorkspaceStopTask(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Stop the workspace',
        task: async (ctx: any, task: any) => {
          await this.cheHelper.stopWorkspace(ctx.cheURL, ctx.workspaceId, this.accessToken)
          task.title = `${task.title}... Done`
        }
      }
    ]
  }

  getWorkspaceCreateTask(devfile: string | undefined, workspaceName: string | undefined): ReadonlyArray<Listr.ListrTask> {
    return [{
      title: 'Create a workspace from the Devfile',
      task: async (ctx: any) => {
        if (!devfile) {
          if (fs.existsSync('devfile.yaml')) {
            devfile = 'devfile.yaml'
          } else if (fs.existsSync('devfile.yml')) {
            devfile = 'devfile.yml'
          }
        }

        if (!devfile) {
          throw new Error("E_DEVFILE_MISSING - Devfile wasn't specified via '-f' option and \'devfile.yaml' is not present in current directory.")
        }
        ctx.workspaceConfig = await this.cheHelper.createWorkspaceFromDevfile(this.cheNamespace, devfile, workspaceName, this.accessToken)
        ctx.workspaceId = ctx.workspaceConfig.id
      }
    }]
  }

  getWorkspaceIdeUrlTask(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Get the workspace IDE URL',
        task: async (ctx: any, task: any) => {
          const workspaceConfig = await this.cheHelper.getWorkspace(ctx.cheURL, ctx.workspaceId, this.accessToken)
          if (workspaceConfig.links && workspaceConfig.links.ide) {
            ctx.workspaceIdeURL = await this.cheHelper.buildDashboardURL(workspaceConfig.links.ide)
          }
          task.title = `${task.title}... Done`
        }
      }
    ]
  }
}
