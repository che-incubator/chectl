/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as Listr from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CA_CERT_GENERATION_JOB_IMAGE, CERT_MANAGER_NAMESPACE_NAME, CHE_ROOT_CA_SECRET_NAME, CHE_TLS_SECRET_NAME } from '../../constants'
import { base64Decode } from '../../util'
import { getMessageImportCaCertIntoBrowser } from '../installers/common-tasks'

export const CERT_MANAGER_CA_SECRET_NAME = 'ca'

export class CertManagerTasks {
  protected kubeHelper: KubeHelper
  protected cheHelper: CheHelper

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
  }

  /**
   * Returns list of tasks which perform cert-manager checks and deploy and requests self-signed certificate for Che.
   */
  getTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
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
          }
        }
      },
      {
        title: 'Deploy cert-manager',
        enabled: ctx => !ctx.certManagerInstalled,
        task: async (ctx: any, task: any) => {
          const yamlPath = path.join(flags.templates, '..', 'installers', 'cert-manager.yml')
          // Apply additional --validate=false flag to be able to deploy Cert Manager on Kubernetes v1.15.4 or below
          await this.kubeHelper.applyResource(yamlPath, '--validate=false')
          ctx.certManagerInstalled = true

          task.title = `${task.title}...done`
        }
      },
      {
        title: 'Wait for cert-manager',
        enabled: ctx => ctx.certManagerInstalled,
        task: async (ctx: any, task: any) => {
          if (!ctx.certManagerInstalled) {
            throw new Error('Cert Manager should be deployed before.')
          }

          const timeout = 5 * 60 * 1000
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cert-manager', CERT_MANAGER_NAMESPACE_NAME, 1000, timeout)
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=webhook', CERT_MANAGER_NAMESPACE_NAME, 1000, timeout)
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cainjector', CERT_MANAGER_NAMESPACE_NAME, 1000, timeout)

          task.title = `${task.title}...ready`
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
                throw new Error('Failed to generate self-signed CA certificate: generating job failed.')
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
        title: 'Set up Eclipse Che certificates issuer',
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
            throw new Error('Eclipse Che certificate already exists.')
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
        title: 'Retrieving Che self-signed CA certificate',
        task: async (ctx: any, task: any) => {
          const cheSecret = await this.kubeHelper.getSecret(CHE_TLS_SECRET_NAME, flags.chenamespace)
          if (cheSecret && cheSecret.data) {
            const cheCaCrt = base64Decode(cheSecret.data['ca.crt'])
            const cheCaCertPath = await this.cheHelper.saveCheCaCert(cheCaCrt)

            // We need to put self-signed CA certificate seprately into CHE_ROOT_CA_SECRET_NAME secret
            await this.kubeHelper.createSecret(CHE_ROOT_CA_SECRET_NAME, { 'ca.crt': cheCaCrt }, flags.chenamespace)

            ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(cheCaCertPath))
            task.title = `${task.title}... is exported to ${cheCaCertPath}`
          } else {
            throw new Error('Failed to get Cert Manager CA secret')
          }
        }
      }
    ]
  }

}
