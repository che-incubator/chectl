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
import { cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
import { ApiTasks } from '../../tasks/platforms/api'
import { PlatformTasks } from '../../tasks/platforms/platform'

const DEFAULT_CA_CERT_FILE_NAME = 'cheCA.crt'

export default class Get extends Command {
  static description = 'Retrieves Eclipse Che self-signed certificate'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s (for kubernetes)\", \"openshift\", \"crc (for CodeReady Containers)\", \"microk8s\".',
      options: ['minikube', 'minishift', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
    }),
    destination: string({
      char: 'd',
      description: `Destination where to store Che certificate.
                    If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
                    If the destination is a directory, then ${DEFAULT_CA_CERT_FILE_NAME} file will be created there with Che certificate in PEM format.
                    If this option is ommited, then Che certificate will be stored in user's home directory as ${DEFAULT_CA_CERT_FILE_NAME}`,
      env: 'CHE_CA_CERT_LOCATION',
      default: '~'
    }),
  }

  async run() {
    const { flags } = this.parse(Get)
    const ctx: any = {}
    const cheHelper = new CheHelper(flags)
    const platformTasks = new PlatformTasks()
    const cheTasks = new CheTasks(flags)
    const apiTasks = new ApiTasks()
    const tasks = new Listr([], { renderer: 'silent' })

    const targetFile = this.prepareTarget(flags.destination)

    tasks.add(platformTasks.preflightCheckTasks(flags, this))
    tasks.add(apiTasks.testApiTasks(flags, this))
    tasks.add(cheTasks.verifyCheNamespaceExistsTask(flags, this))

    try {
      await tasks.run(ctx)
      const cheCaCert = await cheHelper.retrieveEclipseCheCaCert(flags.chenamespace)
      fs.writeFileSync(targetFile, cheCaCert)
      this.log(`Eclipse Che self-signed CA certificate is exported to ${targetFile}`)
    } catch (error) {
      this.error(error)
    }
  }

  /**
   * Handles certificate target location and returns string which points to the target file.
   */
  private prepareTarget(destinaton: string): string {
    if (destinaton === '~') {
      return path.join(os.homedir(), DEFAULT_CA_CERT_FILE_NAME)
    }

    if (fs.existsSync(destinaton)) {
      return fs.lstatSync(destinaton).isDirectory() ? path.join(destinaton, DEFAULT_CA_CERT_FILE_NAME) : destinaton
    }

    throw new Error('Given certificate path doesn\'t exist.')
  }

}
