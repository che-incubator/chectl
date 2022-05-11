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
import { V1Certificate } from '../../api/types/cert-manager'
import { CERT_MANAGER_NAMESPACE_NAME } from '../../constants'
import { getEmbeddedTemplatesDirectory } from '../../util'

export class CertManagerTasks {
  private static readonly ISSUER_NAME = 'che-issuer'

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

  getCreateIssuerTasks(namespace: string): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Create issuer ${CertManagerTasks.ISSUER_NAME}`,
        task: async (ctx: any, task: any) => {
          const issuerExists = await this.kubeHelper.isIssuerExists(CertManagerTasks.ISSUER_NAME, namespace)
          if (issuerExists) {
            task.title = `${task.title}...[Exists]`
            return
          }

          const cheIssuerPath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'che-issuer.yml')
          const cheIssuer = this.kubeHelper.safeLoadFromYamlFile(cheIssuerPath)
          await this.kubeHelper.createIssuer(cheIssuer, namespace)
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  getCreateCertificateTasks(
    flags: any,
    commonName: string,
    dnsNames: string[],
    secretName: string,
    namespace: string): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Request certificate for dnsNames: [${dnsNames}]`,
        task: async (ctx: any, task: any) => {
          const secretExists = await this.kubeHelper.isSecretExists(secretName, namespace)
          if (secretExists) {
            task.title = `${task.title}...[Exists]`
            return
          }

          const cheCertificatePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'che-certificate.yml')
          const cheCertificate = this.kubeHelper.safeLoadFromYamlFile(cheCertificatePath) as V1Certificate
          cheCertificate.metadata.namespace = namespace
          cheCertificate.spec.secretName = secretName
          cheCertificate.spec.commonName = commonName
          cheCertificate.spec.dnsNames = dnsNames
          cheCertificate.spec.issuerRef.name = CertManagerTasks.ISSUER_NAME

          await this.kubeHelper.createCertificate(cheCertificate, namespace)

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: `Wait for secret ${secretName}`,
        task: async (ctx: any, task: any) => {
          await this.kubeHelper.waitSecret(secretName, namespace, ['tls.key', 'tls.crt', 'ca.crt'])
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }
}
