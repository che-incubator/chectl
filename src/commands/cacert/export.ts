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

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { cheNamespace, CHE_TELEMETRY, skipKubeHealthzCheck } from '../../common-flags'
import { DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_CA_CERT_FILE_NAME } from '../../constants'
import { findWorkingNamespace, getCommandErrorMessage } from '../../util'

export default class Export extends Command {
  static description = 'Retrieves Eclipse Che self-signed certificate'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    destination: string({
      char: 'd',
      description: `Destination where to store Che self-signed CA certificate.
                    If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
                    If the destination is a directory, then ${DEFAULT_CA_CERT_FILE_NAME} file will be created there with Che certificate in PEM format.
                    If this option is omitted, then Che certificate will be stored in a user's temporary directory as ${DEFAULT_CA_CERT_FILE_NAME}.`,
      env: 'CHE_CA_CERT_LOCATION',
      default: ''
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    telemetry: CHE_TELEMETRY
  }

  async run() {
    const { flags } = this.parse(Export)
    flags.chenamespace = await findWorkingNamespace(flags)
    await ChectlContext.init(flags, this)

    const kube = new KubeHelper(flags)
    const cheHelper = new CheHelper(flags)
    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Export.id, flags })

    if (!await kube.hasReadPermissionsForNamespace(flags.chenamespace)) {
      throw new Error(`E_PERM_DENIED - Permission denied: no read access to '${flags.chenamespace}' namespace`)
    }
    if (!await kube.getNamespace(flags.chenamespace)) {
      throw new Error(`E_BAD_NS - Namespace ${flags.chenamespace} does not exist. Please specify it with --chenamespace flag`)
    }

    try {
      const cheCaCert = await cheHelper.retrieveCheCaCert(flags.chenamespace)
      if (cheCaCert) {
        const targetFile = await cheHelper.saveCheCaCert(cheCaCert, flags.destination)
        this.log(`Eclipse Che self-signed CA certificate is exported to ${targetFile}`)
      } else {
        this.log('Self signed certificate secret not found. Is commonly trusted certificate used?')
      }
    } catch (err) {
      this.error(getCommandErrorMessage(err))
    }
  }
}
