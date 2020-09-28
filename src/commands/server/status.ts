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

import { KubeHelper } from '../../api/kube'
import { VersionHelper } from '../../api/version'
import { cheNamespace } from '../../common-flags'

export default class List extends Command {
  // Implementation-Version it is a property from Manifest.ml inside of che server pod which indicate Eclipse Che build version.
  readonly chePreffixVersion = 'Implementation-Version: '
  readonly cheServerSelector = 'app=che,component=che'

  static description = 'status Eclipse Che server'
  openshiftOauth = false
  cheVersion = 'UNKNOWN'
  cheUrl = 'UNKNOWN'

  kube = new KubeHelper(flags)

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
  }

  async run() {
    const { flags } = this.parse(List)
    const cr = await this.kube.getCheCluster(flags.chenamespace)

    if (cr && cr.spec && cr.spec.auth && typeof cr.spec.auth.openShiftoAuth === 'boolean') {
      this.openshiftOauth = true
    }

    if (cr && cr.status && cr.status.cheURL) {
      this.cheUrl = cr.status.cheURL
    }

    const chePodList = await this.kube.getPodListByLabel(flags.chenamespace, this.cheServerSelector)
    const [chePodName] = chePodList.map(pod => pod.metadata && pod.metadata.name)

    if (chePodName) {
      await this.getCheVersionByPlatform(flags, chePodName)
    }

    cli.log(`Eclipse Che Verion     : ${this.cheVersion}`)
    cli.log(`Eclipse Che Url        : ${this.cheUrl}`)
    cli.log(`OpenShift OAuth enabled: ${this.openshiftOauth}\n`)

    notifier.notify({
      title: 'chectl',
      message: 'Command server:status has completed successfully.'
    })
  }

  private async getCheVersionByPlatform(flags: any, chePodName: string): Promise<void> {
    try {
      if (await this.kube.isOpenShift()) {
        this.cheVersion = await VersionHelper.getCheVersionWithOC(flags.chenamespace, chePodName, this.chePreffixVersion) || 'UNKNOWN'
      } else {
        this.cheVersion = await VersionHelper.getCheVersionWithKubectl(flags.chenamespace, chePodName, this.chePreffixVersion) || 'UNKNOWN'
      }
    } catch {}
  }
}
