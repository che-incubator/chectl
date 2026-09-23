/**
 * Copyright (c) 2026 Red Hat, Inc.
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

import { initCluster } from '../../devspaces/cluster/cluster-session-manager'
import { configureLogging } from '../../devspaces/utils/logging'

export default class List extends Command {
  static description = 'List developer workspaces (DevWorkspace) for the authenticated account'

  static flags = {
    help: Flags.help({ char: 'h' }),
    auth: Flags.string({
      description: 'Authenticate with the given cluster URL. Once authenticated, the command is performed against the given cluster.',
    }),
    verbose: Flags.boolean({
      description: 'Print more verbose information about state.',
      aliases: ['debug'],
      default: false,
    }),
  }

  async run() {
    const { flags } = await this.parse(List)
    configureLogging(flags.verbose)

    try {
      const { wm } = flags.auth ? await initCluster(flags.auth) : await initCluster()
      const workspaces = wm.getWorkspaces()
      this.log(JSON.stringify(workspaces))
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
