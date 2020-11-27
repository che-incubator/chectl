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

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { cheNamespace } from '../../common-flags'
import { notifyCommandCompletedSuccessfully } from '../../util'

export default class Open extends Command {
  static description = 'Open Eclipse Che dashboard'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
  }

  async run() {
    const { flags } = this.parse(Open)
    await ChectlContext.init(flags, this)

    try {
      const cheHelper = new CheHelper(flags)
      const cheURL = await cheHelper.cheURL(flags.chenamespace)
      const dashboardUrl = `${cheURL}/dashboard/`

      cli.info(`Opening ... ${dashboardUrl}`)
      await cli.open(dashboardUrl)
    } catch (error) {
      this.error(error)
    }

    notifyCommandCompletedSuccessfully()
    this.exit(0)
  }
}
