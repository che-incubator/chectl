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

import { Args, Command, Flags, ux } from '@oclif/core'

import { initCluster } from '../../workspace/cluster/cluster-session-manager'
import { connect } from '../../workspace/connector'
import { configureLogging } from '../../workspace/utils/logging'
import { EclipseChe } from '../../tasks/installers/eclipse-che/eclipse-che'

export default class Connect extends Command {
  static description = `Connect to a developer workspace (DevWorkspace) over SSH. Accepts either a ${EclipseChe.CHE_FLAVOR}:// URI or the name of the workspace.`

  static args = {
    target: Args.string({
      description: `A ${EclipseChe.CHE_FLAVOR}:// connection URI or the name of the workspace. If omitted, you will be prompted for a URI.`,
      required: false,
    }),
  }

  static flags = {
    help: Flags.help({ char: 'h' }),
    unauthorized: Flags.boolean({
      description: 'Whether to bypass the rejection of cluster SSL/TLS certificates that are invalid, expired or self-signed.'
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
      const { wm, kubeConfig, cheUrl } = await initCluster(flags.unauthorized)
      await connect(args.target, wm, kubeConfig, cheUrl)

      // Don't exit - the port forward server needs to keep running.
      // Set up signal handlers for clean shutdown.
      ux.info('\nPort forward is active. Press Ctrl+C to disconnect.')

      process.on('SIGINT', () => {
        ux.log('\nDisconnecting...')
        this.exit(0)
      })

      process.on('SIGTERM', () => {
        ux.log('\nDisconnecting...')
        this.exit(0)
      })
    } catch (error: any) {
      this.error(error)
    }
  }
}
