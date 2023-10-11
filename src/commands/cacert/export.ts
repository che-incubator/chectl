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

import { Command, Flags } from '@oclif/core'
import * as fs from 'fs-extra'
import * as os from 'node:os'
import * as path from 'node:path'
import { CheCtlContext } from '../../context'
import {
  CHE_NAMESPACE_FLAG,
  CHE_NAMESPACE,
  LISTR_RENDERER_FLAG,
  LISTR_RENDERER,
  TELEMETRY_FLAG,
  TELEMETRY,
  DESTINATION_FLAG, DESTINATION,
} from '../../flags'
import { DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import {EclipseChe} from '../../tasks/installers/eclipse-che/eclipse-che'
import {wrapCommandError} from '../../utils/command-utils'
import {Che} from '../../utils/che'

export default class Export extends Command {
  static description = `Retrieves ${EclipseChe.PRODUCT_NAME} self-signed certificate`

  static flags = {
    help: Flags.help({ char: 'h' }),
    [CHE_NAMESPACE_FLAG]: CHE_NAMESPACE,
    [LISTR_RENDERER_FLAG]: LISTR_RENDERER,
    [TELEMETRY_FLAG]: TELEMETRY,
    [DESTINATION_FLAG]: DESTINATION,
  }

  async run() {
    const { flags } = await this.parse(Export)
    await CheCtlContext.init(flags, this)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Export.id, flags })

    try {
      const cheCaCert = await Che.readCheCaCert(flags[CHE_NAMESPACE_FLAG]!)
      if (cheCaCert) {
        const targetFile = this.getTargetFile(flags[DESTINATION_FLAG])
        fs.writeFileSync(targetFile, cheCaCert)
        this.log(`${EclipseChe.PRODUCT_NAME} self-signed CA certificate is exported to ${targetFile}`)
      } else {
        this.log('Self signed certificate secret not found. Is commonly trusted certificate used?')
      }
    } catch (err: any) {
      this.error(wrapCommandError(err))
    }
  }

  private getTargetFile(destination: string | undefined): string {
    if (!destination) {
      return path.join(os.tmpdir(), EclipseChe.DEFAULT_CA_CERT_FILE_NAME)
    }

    if (fs.existsSync(destination)) {
      return fs.lstatSync(destination).isDirectory() ? path.join(destination, EclipseChe.DEFAULT_CA_CERT_FILE_NAME) : destination
    }

    throw new Error(`Path \'${destination}\' doesn't exist.`)
  }
}
