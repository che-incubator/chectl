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

import { Args, Command, Flags } from '@oclif/core'

import { initCluster } from '../../workspace/cluster/cluster-session-manager'
import { connect } from '../../workspace/connector'
import { configureLogging } from '../../workspace/utils/logging'

export default class Connect extends Command {
  static description = 'Connect to a developer workspace (DevWorkspace) over SSH. Accepts either a che:// URI or the name of the workspace.'

  static args = {
    target: Args.string({
      description: 'A che:// connection URI or the name of the workspace. If omitted, you will be prompted for a URI.',
      required: false,
    }),
  }

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
    const { args, flags } = await this.parse(Connect)
    configureLogging(flags.verbose)

    try {
      const { wm, kubeConfig, cheUrl } = flags.auth ? await initCluster(flags.auth) : await initCluster()
      await connect(args.target, wm, kubeConfig, cheUrl)

      // Don't exit - the port forward server needs to keep running.
      // Set up signal handlers for clean shutdown.
      console.info('\nPort forward is active. Press Ctrl+C to disconnect.')

      process.on('SIGINT', () => {
        console.log('\nDisconnecting...')
        process.exit(0)
      })

      process.on('SIGTERM', () => {
        console.log('\nDisconnecting...')
        process.exit(0)
      })
    } catch (error: any) {
      this.error(error)
    }
  }
}
