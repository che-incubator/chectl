/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'

import { ChectlContext } from '../../api/context'
import { accessToken, cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'

export default class Stop extends Command {
  static description = 'stop Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'che-selector': string({
      description: 'Selector for Eclipse Che server resources',
      default: 'app=che,component=che',
      env: 'CHE_SELECTOR',
    }),
    'access-token': accessToken,
    'listr-renderer': listrRenderer,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Stop)
    flags.chenamespace = await findWorkingNamespace(flags)
    await ChectlContext.init(flags, this)

    const Listr = require('listr')
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Stop.id, flags })

    const tasks = new Listr(undefined,
      {
        renderer: flags['listr-renderer'] as any,
        collapse: false,
      }
    )

    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add(cheTasks.checkIfCheIsInstalledTasks(flags))
    tasks.add([
      {
        title: 'Deployment doesn\'t exist',
        enabled: (ctx: any) => !ctx.isCheDeployed,
        task: async () => {
          await this.error('Eclipse Che deployment not found')
        },
      },
    ],
    { renderer: flags['listr-renderer'] as any }
    )
    tasks.add(cheTasks.scaleCheDownTasks())
    tasks.add(cheTasks.waitPodsDeletedTasks())
    try {
      await tasks.run()
      cli.log(getCommandSuccessMessage())
    } catch (err) {
      this.error(wrapCommandError(err))
    }

    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }
}
