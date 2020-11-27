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
import { cli } from 'cli-ux'
import * as notifier from 'node-notifier'

import { CheHelper } from '../../api/che'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { cheNamespace } from '../../common-flags'
import { getCommandSuccessMessage } from '../../util'

export default class Status extends Command {
  // Implementation-Version it is a property from Manifest.ml inside of che server pod which indicate Eclipse Che build version.
  static description = 'Status Eclipse Che server'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
  }

  async run() {
    const { flags } = this.parse(Status)
    const ctx = await ChectlContext.initAndGet(flags, this)

    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)

    let openshiftOauth = 'No'

    const cr = await kube.getCheCluster(flags.chenamespace)
    if (ctx.isOpenShift && cr && cr.spec && cr.spec.auth && cr.spec.auth.openShiftoAuth) {
      openshiftOauth = 'Yes'
    }

    const cheVersion = await VersionHelper.getCheVersion(flags)

    cli.log(`Eclipse Che Version    : ${cheVersion}`)
    cli.log(`Eclipse Che Url        : ${await che.cheURL(flags.chenamespace)}`)
    cli.log(`OpenShift OAuth enabled: ${openshiftOauth}\n`)

    notifier.notify({
      title: 'chectl',
      message: getCommandSuccessMessage()
    })
  }
}
