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
import { cli } from 'cli-ux'

import { CheCtlContext } from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
} from '../../flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {Che} from '../../utils/che'

export default class Status extends Command {
  static description = `Status ${EclipseChe.PRODUCT_NAME} server`

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Status)
    await CheCtlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Status.id, flags })

    cli.log(`${EclipseChe.PRODUCT_NAME} Version    : ${await Che.getCheVersion()}`)
    cli.log(`${EclipseChe.PRODUCT_NAME} Url        : ${Che.buildDashboardURL(await Che.getCheURL(flags[CHE_NAMESPACE_FLAG]))}`)
  }
}
