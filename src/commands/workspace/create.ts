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
import cli from 'cli-ux'

import { initCluster } from '../../devspaces/cluster/cluster-session-manager'
import { configureLogging } from '../../devspaces/utils/logging'

export default class Create extends Command {
  static description = 'Create a developer workspace (DevWorkspace) for the given devfile URL'

  static args = {
    devfileUrl: Args.string({
      description: 'Devfile URL to create the workspace from. Defaults to an empty workspace.',
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
    const { args, flags } = await this.parse(Create)
    configureLogging(flags.verbose)

    try {
      const { devspacesUrl } = flags.auth ? await initCluster(flags.auth) : await initCluster()
      const devfileUrl = args.devfileUrl && args.devfileUrl.length > 0 ?
        args.devfileUrl :
        `${devspacesUrl}/dashboard/devfile-registry/devfiles/empty.yaml`
      const workspaceUrl = `${devspacesUrl}/dashboard/#/load-factory?url=${encodeURIComponent(devfileUrl)}&policies.create=perclick`
      this.log(`Opening ... ${workspaceUrl}`)
      await cli.open(workspaceUrl)
    } catch (error: any) {
      this.error(error)
    }

    this.exit(0)
  }
}
