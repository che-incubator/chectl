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

import UpdateCommand from '@oclif/plugin-update/lib/commands/update'
import { cli } from 'cli-ux'
import * as notifier from 'node-notifier'
import {newError} from './utls'
import {CheCtlContext, CliContext} from '../context'
import * as fs from 'fs'
import {CheCtlVersion} from './chectl-version'
import {EclipseChe} from '../tasks/installers/eclipse-che/eclipse-che'

/**
 * Returns command success message with execution time.
 */
export function getCommandSuccessMessage(): string {
  const ctx = CheCtlContext.get()

  if (ctx[CliContext.CLI_COMMAND_START_TIME]) {
    if (!ctx[CliContext.CLI_COMMAND_END_TIME]) {
      ctx[CliContext.CLI_COMMAND_END_TIME] = Date.now()
    }

    const workingTimeInSeconds = Math.round((ctx[CliContext.CLI_COMMAND_END_TIME] - ctx[CliContext.CLI_COMMAND_START_TIME]) / 1000)
    const minutes = Math.floor(workingTimeInSeconds / 60)
    const seconds = (workingTimeInSeconds - minutes * 60) % 60
    const minutesToStr = minutes.toLocaleString([], { minimumIntegerDigits: 2 })
    const secondsToStr = seconds.toLocaleString([], { minimumIntegerDigits: 2 })
    return `Command ${ctx[CliContext.CLI_COMMAND_ID]} has completed successfully in ${minutesToStr}:${secondsToStr}.`
  }

  return `Command ${ctx[CliContext.CLI_COMMAND_ID]} has completed successfully.`
}

/**
 * Wraps error into command error.
 */
export function wrapCommandError(error: Error): Error {
  const ctx = CheCtlContext.get()
  const logDirectory = ctx[CliContext.CLI_COMMAND_LOGS_DIR]

  let commandErrorMessage = `Command ${ctx[CliContext.CLI_COMMAND_ID]} failed with the error: ${error.message} See details: ${ctx[CliContext.CLI_ERROR_LOG]}.`
  if (logDirectory && !isDirEmpty(logDirectory)) {
    commandErrorMessage += ` ${EclipseChe.PRODUCT_NAME} logs: ${logDirectory}.`
  }

  return newError(commandErrorMessage, error)
}

export function notifyCommandCompletedSuccessfully(): void {
  notifier.notify({
    title: 'chectl',
    message: getCommandSuccessMessage(),
  })
}

export async function askForChectlUpdateIfNeeded(): Promise<void> {
  const ctx = CheCtlContext.get()
  if (await CheCtlVersion.isCheCtlUpdateAvailable(ctx[CliContext.CLI_CACHE_DIR])) {
    cli.info(`A more recent version of chectl is available. To deploy the latest version of ${EclipseChe.PRODUCT_NAME}, update the chectl tool first.`)
    if (await cli.confirm('Do you want to update chectl now? [y/n]')) {
      // Update chectl
      await UpdateCommand.run([])
      cli.exit(0)
    }
  }
}

function isDirEmpty(dirname: string): boolean {
  try {
    return fs.readdirSync(dirname).length === 0
    // Fails in case if directory doesn't exist
  } catch {
    return true
  }
}
