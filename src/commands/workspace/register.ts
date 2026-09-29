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

import { registerUrlHandler } from '../../workspace/handler'
import { configureLogging } from '../../workspace/utils/logging'
import { EclipseChe } from '../../tasks/installers/eclipse-che/eclipse-che'

export default class Register extends Command {
  static description = `Register a ${EclipseChe.CHE_FLAVOR}:// URL handler so that connection links open directly with chectl. This eliminates the need to copy connection data by hand.`

  static aliases = ['workspace:register-url-handler']

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
    const { flags } = await this.parse(Register)
    configureLogging(flags.verbose)

    try {
      // process.execPath is the node binary; process.argv[1] is the chectl entrypoint.
      // $_URL_ is substituted with the actual che:// URL by protocol-registry.
      const command = `"${process.execPath}" "${process.argv[1]}" workspace:connect "$_URL_"`
      await registerUrlHandler(command, flags.force)
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
