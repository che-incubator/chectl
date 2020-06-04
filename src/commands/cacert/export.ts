/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as os from 'os'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { cheNamespace, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_CA_CERT_FILE_NAME } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'

export default class Export extends Command {
  static description = 'Retrieves Eclipse Che self-signed certificate'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    destination: string({
      char: 'd',
      description: `Destination where to store Che self-signed CA certificate.
                    If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
                    If the destination is a directory, then ${DEFAULT_CA_CERT_FILE_NAME} file will be created there with Che certificate in PEM format.
                    If this option is ommited, then Che certificate will be stored in user's home directory as ${DEFAULT_CA_CERT_FILE_NAME}`,
      env: 'CHE_CA_CERT_LOCATION',
      default: ''
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck
  }

  async run() {
    const { flags } = this.parse(Export)
    const ctx: any = {}
    const cheHelper = new CheHelper(flags)
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()
    const tasks = new Listr([], { renderer: 'silent' })

    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))

    try {
      await tasks.run(ctx)
      const cheCaCert = await cheHelper.retrieveCheCaCert(flags.chenamespace)
      if (cheCaCert) {
        const targetFile = await cheHelper.saveCheCaCert(cheCaCert, this.getTargetFile(flags.destination))
        this.log(`Eclipse Che self-signed CA certificate is exported to ${targetFile}`)
      } else {
        this.log('Seems commonly trusted certificate is used.')
      }
    } catch (error) {
      this.error(error)
    }
  }

  /**
   * Handles certificate target location and returns string which points to the target file.
   */
  private getTargetFile(destinaton: string): string {
    if (!destinaton) {
      return path.join(os.homedir(), DEFAULT_CA_CERT_FILE_NAME)
    }

    if (fs.existsSync(destinaton)) {
      return fs.lstatSync(destinaton).isDirectory() ? path.join(destinaton, DEFAULT_CA_CERT_FILE_NAME) : destinaton
    }

    this.error(`Given path "${destinaton}" doesn't exist.`)
  }

}
