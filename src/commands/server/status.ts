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
import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { cheNamespace } from '../../common-flags'
import { CheTasks } from '../../tasks/che'
export default class List extends Command {
  // Implementation-Version it is a property from Manifest.ml inside of che server pod which indicate Eclipse Che build version.
  readonly chePreffixVersion = 'Implementation-Version: '
  static description = 'status Eclipse Che server'
  openshiftOauth = 'No'
  cheVersion = 'UNKNOWN'

  kube = new KubeHelper(flags)
  che = new CheHelper(flags)
  cheTask = new CheTasks(flags)

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
  }

  async run() {
    const { flags } = this.parse(List)
    const cr = await this.kube.getCheCluster(flags.chenamespace)

    if (cr && cr.spec && cr.spec.auth && typeof cr.spec.auth.openShiftoAuth === 'boolean') {
      this.openshiftOauth = 'Yes'
    }

    const chePodList = await this.kube.getPodListByLabel(flags.chenamespace, this.cheTask.cheSelector)
    const [chePodName] = chePodList.map(pod => pod.metadata && pod.metadata.name)

    if (chePodName) {
      this.cheVersion = await VersionHelper.getCheVersionFromPod(flags.chenamespace, chePodName, this.chePreffixVersion)
    }

    cli.log(`Eclipse Che Verion     : ${this.cheVersion}`)
    cli.log(`Eclipse Che Url        : ${await this.che.cheURL(flags.chenamespace)}`)
    cli.log(`OpenShift OAuth enabled: ${this.openshiftOauth}\n`)

    notifier.notify({
      title: 'chectl',
      message: 'Command server:status has completed successfully.'
    })
  }
}
