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
import * as Listr from 'listr'
import * as notifier from 'node-notifier'

import { cheDeployment, cheNamespace, directory, k8sPodDownloadImageTimeout, K8SPODDOWNLOADIMAGETIMEOUT_KEY, k8sPodErrorRecheckTimeout, K8SPODERRORRECHECKTIMEOUT_KEY, k8sPodReadyTimeout, K8SPODREADYTIMEOUT_KEY, k8sPodWaitTimeout, K8SPODWAITTIMEOUT_KEY, listrRenderer, LOG_DIRECTORY_KEY, skipKubeHealthzCheck } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { getCommandFailMessage, getCommandSuccessMessage, initializeContext } from '../../util'

export default class Start extends Command {
  static description = 'start Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    'deployment-name': cheDeployment,
    [K8SPODWAITTIMEOUT_KEY]: k8sPodWaitTimeout,
    [K8SPODREADYTIMEOUT_KEY]: k8sPodReadyTimeout,
    [K8SPODDOWNLOADIMAGETIMEOUT_KEY]: k8sPodDownloadImageTimeout,
    [K8SPODERRORRECHECKTIMEOUT_KEY]: k8sPodErrorRecheckTimeout,
    [LOG_DIRECTORY_KEY]: directory,
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
  }

  async run() {
    const { flags } = this.parse(Start)
    const ctx = await initializeContext(flags)

    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()

    // Checks if Eclipse Che is already deployed
    const preInstallTasks = new Listr([
      apiTasks.testApiTasks(flags, this),
      {
        title: '👀  Looking for an already existing Eclipse Che instance',
        task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
      }], ctx.listrOptions)

    const logsTasks = new Listr([{
      title: 'Following Eclipse Che logs',
      task: () => new Listr(cheTasks.serverLogsTasks(flags, true))
    }], ctx.listrOptions)

    const startCheTasks = new Listr([{
      title: 'Starting Eclipse Che',
      task: () => new Listr(cheTasks.scaleCheUpTasks())
    }], ctx.listrOptions)

    try {
      await preInstallTasks.run(ctx)

      if (!ctx.isCheDeployed) {
        cli.warn('Eclipse Che has not been deployed yet. Use server:deploy command to deploy a new Eclipse Che instance.')
      } else if (ctx.isCheReady) {
        cli.info('Eclipse Che has been already started.')
      } else {
        await logsTasks.run(ctx)
        await startCheTasks.run(ctx)
        this.log(getCommandSuccessMessage(this, ctx))
      }
    } catch (err) {
      this.error(`${err}\n${getCommandFailMessage(this, ctx)}`)
    }

    notifier.notify({
      title: 'chectl',
      message: getCommandSuccessMessage(this, ctx)
    })

    this.exit(0)
  }

}
