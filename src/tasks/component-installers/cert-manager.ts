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

import * as Listr from 'listr'
import * as path from 'path'
import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CERT_MANAGER_NAMESPACE_NAME } from '../../constants'
import { getEmbeddedTemplatesDirectory } from '../../util'

export class CertManagerTasks {
  protected kubeHelper: KubeHelper
  protected cheHelper: CheHelper
  protected skipCertManager: boolean

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
    this.skipCertManager = flags['skip-cert-manager']
  }

  getDeployCertManagerTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Cert Manager v1.5.3',
        skip: () => this.skipCertManager,
        task: async (ctx: any, _task: any) => {
          const tasks = new Listr(undefined, ctx.listrOptions)
          tasks.add(
            {
              title: 'Install Cert Manager',
              task: async (ctx: any, task: any) => {
                const certManagerCrd = await this.kubeHelper.getCrd('certificates.cert-manager.io')
                if (certManagerCrd) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlPath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'cert-manager.yml')
                  await this.kubeHelper.applyResource(yamlPath)
                  task.title = `${task.title}...[OK]`
                }
              },
            })

          tasks.add(
            {
              title: 'Wait for Cert Manager',
              task: async (ctx: any, task: any) => {
                await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cert-manager', CERT_MANAGER_NAMESPACE_NAME)
                await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=webhook', CERT_MANAGER_NAMESPACE_NAME)
                await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cainjector', CERT_MANAGER_NAMESPACE_NAME)
                task.title = `${task.title}...[OK]`
              },
            }
          )

          return tasks
        },
      },
    ]
  }
}
