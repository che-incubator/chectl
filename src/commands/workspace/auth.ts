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
import { configureLogging } from '../../workspace/utils/logging'

export default class Auth extends Command {
  static description = 'Authenticate against a given cluster URL.'

  static args = {
    target: Args.string({
      description: 'Authenticate with the given cluster URL.',
      required: true,
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
    const { args, flags } = await this.parse(Auth)
    configureLogging(flags.verbose)

    try {
      const { cheUrl } = await initCluster(flags.unauthorized, args.target)
      ux.info(`Successfully authenticated against ${cheUrl}`);
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
