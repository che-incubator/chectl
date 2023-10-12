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

import { Command, Flags } from '@oclif/core'
import { ux } from '@oclif/core'
import cli from 'cli-ux'

import { CheCtlContext } from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  TELEMETRY_FLAG, TELEMETRY,
} from '../../flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {Che} from '../../utils/che'

export default class Open extends Command {
  static description = `Open ${EclipseChe.PRODUCT_NAME} dashboard`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [TELEMETRY_FLAG]: TELEMETRY,
  }

  async run() {
    const { flags } = await this.parse(Open)
    await CheCtlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Open.id, flags })

    try {
      const dashboardUrl = Che.buildDashboardURL(await Che.getCheURL(flags[CHE_NAMESPACE_FLAG]!))

      ux.info(`Opening ... ${dashboardUrl}`)
      await cli.open(dashboardUrl)
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
