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
import * as os from 'os'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { CHE_TELEMETRY, FOLLOW_LOGS, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'

export default class Logs extends Command {
  static description = 'Collect workspace(s) logs'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    workspace: string({
      char: 'w',
      description: 'Target workspace id. Can be found in workspace configuration \'id\' field.',
      required: true
    }),
    namespace: string({
      char: 'n',
      description: 'The namespace where workspace is located. Can be found in workspace configuration \'attributes.infrastructureNamespace\' field.',
      required: true
    }),
    directory: string({
      char: 'd',
      description: 'Directory to store logs into',
      env: 'CHE_LOGS'
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY,
    follow: FOLLOW_LOGS
  }

  async run() {
    const { flags } = this.parse(Logs)
    await ChectlContext.init(flags, this)

    const logsDirectory = path.resolve(flags.directory ? flags.directory : path.resolve(os.tmpdir(), 'chectl-logs', Date.now().toString()))

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Logs.id, flags })
    const cheHelper = new CheHelper(flags)
    await cheHelper.readWorkspacePodLog(flags.namespace, flags.workspace, logsDirectory, flags.follow)

    this.log(`Workspace logs will be available in '${logsDirectory}'`)
  }
}
