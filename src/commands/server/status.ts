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

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { VersionHelper } from '../../api/version'
import { cheNamespace, CHE_TELEMETRY } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CHE_NAMESPACE } from '../../constants'
import { findWorkingNamespace } from '../../util'

export default class Status extends Command {
  static description = 'Status Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Status)
    flags.chenamespace = flags.chenamespace || await findWorkingNamespace(flags) || DEFAULT_CHE_NAMESPACE
    await ChectlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Status.id, flags })

    const che = new CheHelper(flags)
    const cheVersion = await VersionHelper.getCheVersion(flags)

    cli.log(`Eclipse Che Version    : ${cheVersion}`)
    cli.log(`Eclipse Che Url        : ${che.buildDashboardURL(await che.cheURL(flags.chenamespace))}`)
  }
}
