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

import { registerDevspacesHandler } from '../../workspace/handler'
import { configureLogging } from '../../workspace/utils/logging'

export default class Init extends Command {
  static description = 'Register a devspaces:// URL handler so that connection links open directly with chectl. This eliminates the need to copy connection data by hand.'

  static aliases = ['workspace:install']

  static flags = {
    help: Flags.help({ char: 'h' }),
    force: Flags.boolean({
      description: 'Re-register the URL handler even if one already exists (for example to re-point an existing registration at chectl).',
      default: false,
    }),
    verbose: Flags.boolean({
      description: 'Print more verbose information about state.',
      aliases: ['debug'],
      default: false,
    }),
  }

  async run() {
    const { flags } = await this.parse(Init)
    configureLogging(flags.verbose)

    try {
      // process.execPath is the node binary; process.argv[1] is the chectl entrypoint.
      // $_URL_ is substituted with the actual devspaces:// URL by protocol-registry.
      const command = `"${process.execPath}" "${process.argv[1]}" workspace:connect "$_URL_"`
      await registerDevspacesHandler(command, flags.force)
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
