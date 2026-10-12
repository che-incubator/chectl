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

import { initCluster } from '../../workspace/cluster/cluster-session-manager'
import { configureLogging } from '../../workspace/utils/logging'

export default class List extends Command {
  static description = 'List developer workspaces (DevWorkspace) for the authenticated account'

  static flags = {
    help: Flags.help({ char: 'h' }),
    unauthorized: Flags.boolean({
      description: 'Whether to bypass the rejection of cluster SSL/TLS certificates that are invalid, expired or self-signed.'
    }),
    json: Flags.boolean({
      description: 'Format output as JSON.'
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
      // Use native import() to load ESM module from CommonJS
      // eslint-disable-next-line no-new-func
      const importDynamic = new Function('specifier', 'return import(specifier)')
      const { printTable } = await importDynamic('@oclif/table')
      const { wm } = await initCluster(flags.unauthorized)
      const workspaces = wm.getWorkspaces();
      if (flags.json) {
        this.log(JSON.stringify(workspaces))
      } else {
        printTable({
          title: 'Workspaces',
          data: workspaces,
          columns: [
            { key: 'name' },
            { key: 'namespace' },
            { key: 'phase' },
            { key: 'started' }
          ],
        })
      }
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
