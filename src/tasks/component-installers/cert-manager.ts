/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command } from '@oclif/command'
import * as fs from 'fs'
import * as Listr from 'listr'
import * as os from 'os'
import * as path from 'path'

import { KubeHelper } from '../../api/kube'
import { CERT_MANAGER_NAMESPACE_NAME, CHE_TLS_SECRET_NAME } from '../../constants'

export const CERT_MANAGER_CA_SECRET_NAME = 'ca'

export class CertManagerTasks {
  protected kubeHelper: KubeHelper

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
  }

  /**
   * Returns list of tasks which perform cert-manager checks and deploy and requests self-signed certificate for Che.
   */
  getTasks(flags: any, command: Command): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Check Cert Manager deployment',
        task: async (ctx: any, task: any) => {
          // Check only one CRD of cert-manager assuming that it is installed or not.
          ctx.certManagerInstalled = await this.kubeHelper.namespaceExist(CERT_MANAGER_NAMESPACE_NAME) && await this.kubeHelper.crdExist('certificates.cert-manager.io')
          if (ctx.certManagerInstalled) {
            task.title = `${task.title}...already deployed`
          } else {
            task.title = `${task.title}...not deployed`

            return new Listr([
              {
                title: 'Deploy cert-manager',
                task: async (ctx: any, task: any) => {
                  const yamlPath = path.join(flags.templates, 'cert-manager', 'cert-manager.yml')
                  await this.kubeHelper.applyResource(yamlPath)
                  ctx.certManagerInstalled = true

                  task.title = `${task.title}...done`
                }
              },
              {
                title: 'Wait for cert-manager',
                task: async (ctx: any, task: any) => {
                  if (!ctx.certManagerInstalled) {
                    throw new Error('Cert Manager should be deployed before.')
                  }

                  await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cert-manager', CERT_MANAGER_NAMESPACE_NAME)
                  await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=webhook', CERT_MANAGER_NAMESPACE_NAME)
                  await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cainjector', CERT_MANAGER_NAMESPACE_NAME)

                  task.title = `${task.title}...ready`
                }
              }
            ], ctx.listrOptions)
          }
        }
      },
      {
        title: 'Check Cert Manager CA certificate',
        task: async (ctx: any, task: any) => {
          if (!ctx.certManagerInstalled) {
            throw new Error('Cert manager must be installed before.')
          }
          // To be able to use self-signed sertificate it is required to provide CA private key & certificate to cert-manager
          const caSelfSignedCertSecret = await this.kubeHelper.getSecret(CERT_MANAGER_CA_SECRET_NAME, CERT_MANAGER_NAMESPACE_NAME)
          if (!caSelfSignedCertSecret) {
            // First run, generate CA self-signed certificate

            task.title = `${task.title}...generating new one`

            const CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME = 'ca-cert-generator'
            const CA_CERT_GENERATION_JOB_NAME = 'ca-cert-generation-job'
            const CA_CERT_GENERATION_JOB_IMAGE = 'quay.io/eclipse/che-cert-manager-ca-cert-generator:latest'
            try {
              // Configure permissions for CA key pair generation job
              await this.kubeHelper.createServiceAccount(CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME, CERT_MANAGER_NAMESPACE_NAME)
              await this.kubeHelper.createRoleFromFile(path.join(flags.templates, 'cert-manager', 'ca-cert-generator-role.yml'), CERT_MANAGER_NAMESPACE_NAME)
              await this.kubeHelper.createRoleBindingFromFile(path.join(flags.templates, 'cert-manager', 'ca-cert-generator-role-binding.yml'), CERT_MANAGER_NAMESPACE_NAME)

              // Await created resources to be available
              await this.kubeHelper.waitServiceAccount(CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME, CERT_MANAGER_NAMESPACE_NAME)

              // Run CA key pair generation job
              try {
                await this.kubeHelper.createJob(CA_CERT_GENERATION_JOB_NAME, CA_CERT_GENERATION_JOB_IMAGE, CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME, CERT_MANAGER_NAMESPACE_NAME)
                await this.kubeHelper.waitJob(CA_CERT_GENERATION_JOB_NAME, CERT_MANAGER_NAMESPACE_NAME)
              } catch {
                command.error('Failed to generate self-signed CA certificate: generating job failed.')
              }
            } finally {
              // Clean up resources
              try {
                // Do not change order of statements.
                // Despite logically it is better to remove role binding first, we should delete items here in order of their creation.
                // Such approach will resolve situation if only subset of items were created during previos run.
                await this.kubeHelper.deleteServiceAccount(CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME, CERT_MANAGER_NAMESPACE_NAME)
                await this.kubeHelper.deleteRole('ca-cert-generator-role', CERT_MANAGER_NAMESPACE_NAME)
                await this.kubeHelper.deleteRoleBinding('ca-cert-generator-role-binding', CERT_MANAGER_NAMESPACE_NAME)

                await this.kubeHelper.deleteJob(CA_CERT_GENERATION_JOB_NAME, CERT_MANAGER_NAMESPACE_NAME)
              } catch {
                // Do nothing
              }
            }

            // Wait until the secret is available
            await this.kubeHelper.waitSecret('ca', CERT_MANAGER_NAMESPACE_NAME)
          } else {
            task.title = `${task.title}...already exists`
          }
        }
      },
      {
        title: 'Set up Che certificates issuer',
        task: async (_ctx: any, task: any) => {
          const cheClusterIssuerExists = await this.kubeHelper.clusterIssuerExists('che-cluster-issuer')
          if (!cheClusterIssuerExists) {
            const cheCertificateClusterIssuerTemplatePath = path.join(flags.templates, '/cert-manager/che-cluster-issuer.yml')
            await this.kubeHelper.createCheClusterIssuer(cheCertificateClusterIssuerTemplatePath)

            task.title = `${task.title}...done`
          } else {
            task.title = `${task.title}...already exists`
          }
        }
      },
      {
        title: 'Request self-signed certificate',
        task: async (ctx: any, task: any) => {
          if (ctx.cheCertificateExists) {
            throw new Error('Che certificate already exists.')
          }

          const certificateTemplatePath = path.join(flags.templates, '/cert-manager/che-certificate.yml')
          await this.kubeHelper.createCheClusterCertificate(certificateTemplatePath, flags.domain, flags.chenamespace)
          ctx.cheCertificateExists = true

          task.title = `${task.title}...done`
        }
      },
      {
        title: 'Wait for self-signed certificate',
        task: async (_ctx: any, task: any) => {
          await this.kubeHelper.waitSecret(CHE_TLS_SECRET_NAME, flags.chenamespace, ['tls.key', 'tls.crt', 'ca.crt'])

          task.title = `${task.title}...ready`
        }
      },
      {
        title: 'Add local Che CA certificate into browser',
        task: async (_ctx: any, task: any) => {
          const cheSecret = await this.kubeHelper.getSecret(CHE_TLS_SECRET_NAME, flags.chenamespace)
          if (cheSecret && cheSecret.data) {
            const cheCaCrt = Buffer.from(cheSecret.data['ca.crt'], 'base64').toString('ascii')
            const cheCaPublicCertPath = path.join(os.homedir(), 'cheCA.crt')
            fs.writeFileSync(cheCaPublicCertPath, cheCaCrt)

            const yellow = '\x1b[33m'
            const noColor = '\x1b[0m'
            task.title = `❗${yellow}[MANUAL ACTION REQUIRED]${noColor} Please add local Che CA certificate into your browser: ${cheCaPublicCertPath}`
          } else {
            throw new Error('Failed to get Cert Manager CA secret')
          }
        }
      }
    ]
  }

}
