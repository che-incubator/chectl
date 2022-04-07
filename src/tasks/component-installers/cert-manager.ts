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

import * as fs from 'fs-extra'
import * as os from 'os'
import * as Listr from 'listr'
import * as path from 'path'
import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { V1Certificate } from '../../api/types/cert-manager'
import { CA_CERT_GENERATION_JOB_IMAGE, CERT_MANAGER_NAMESPACE_NAME, CHE_RELATED_COMPONENT_LABEL, CHE_ROOT_CA_SECRET_NAME, CHE_TLS_SECRET_NAME, DEFAULT_CA_CERT_FILE_NAME } from '../../constants'
import { base64Decode, getEmbeddedTemplatesDirectory } from '../../util'
import { getMessageImportCaCertIntoBrowser } from '../installers/common-tasks'

export const CERT_MANAGER_CA_SECRET_NAME = 'ca'
export const DEFAULT_CHE_CLUSTER_ISSUER_NAME = 'che-cluster-issuer'

export class CertManagerTasks {
  protected kubeHelper: KubeHelper

  protected cheHelper: CheHelper

  constructor(flags: any) {
    this.kubeHelper = new KubeHelper(flags)
    this.cheHelper = new CheHelper(flags)
  }

  /**
   * Verify if cert-manager is installed in cluster
   */
  getDeployCertManagerTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Install Cert Manager',
        task: async (_ctx: any, task: any) => {
          const certManagerCrd = await this.kubeHelper.getCrd('certificates.cert-manager.io')
          if (certManagerCrd) {
            task.title = `${task.title}...[Exists]`
          } else {
            const yamlPath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'cert-manager.yml')
            await this.kubeHelper.applyResource(yamlPath)
            task.title = `${task.title}...[OK]`
          }
        },
      },
      {
        title: 'Wait for Cert Manager',
        task: async (ctx: any, task: any) => {
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cert-manager', CERT_MANAGER_NAMESPACE_NAME)
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=webhook', CERT_MANAGER_NAMESPACE_NAME)
          await this.kubeHelper.waitForPodReady('app.kubernetes.io/name=cainjector', CERT_MANAGER_NAMESPACE_NAME)

          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  getGenerateCertManagerCACertificateTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Check Cert Manager CA certificate',
        task: async (_ctx: any, task: any) => {
          // To be able to use self-signed sertificate it is required to provide CA private key & certificate to cert-manager
          const caSelfSignedCertSecret = await this.kubeHelper.getSecret(CERT_MANAGER_CA_SECRET_NAME, CERT_MANAGER_NAMESPACE_NAME)
          if (!caSelfSignedCertSecret) {
            // First run, generate CA self-signed certificate

            task.title = `${task.title}...[Generating new one]`

            const CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME = 'ca-cert-generator'
            const CA_CERT_GENERATION_JOB_NAME = 'ca-cert-generation-job'
            try {
              // Configure permissions for CA key pair generation job
              await this.kubeHelper.createServiceAccount(CA_CERT_GENERATION_SERVICE_ACCOUNT_NAME, CERT_MANAGER_NAMESPACE_NAME)
              await this.kubeHelper.createRoleFromFile(path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'ca-cert-generator-role.yml'), CERT_MANAGER_NAMESPACE_NAME)
              await this.kubeHelper.createRoleBindingFromFile(path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'ca-cert-generator-role-binding.yml'), CERT_MANAGER_NAMESPACE_NAME)

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
            task.title = `${task.title}...[Exists]`
          }
        },
      },
    ]
  }

  getCreateCertificateIssuerTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Set up Eclipse Che certificates issuer',
        task: async (ctx: any, task: any) => {
          let clusterIssuers = await this.kubeHelper.listClusterIssuers(CHE_RELATED_COMPONENT_LABEL)
          if (clusterIssuers.length > 1) {
            throw new Error(`Found more than one cluster issuer with "${CHE_RELATED_COMPONENT_LABEL}" label`)
          } else if (clusterIssuers.length === 1) {
            // Found already configured cluster issuer
            ctx.clusterIssuersName = clusterIssuers[0].metadata.name
            task.title = `${task.title}...[Found: ${ctx.clusterIssuersName}]`
            return
          }

          // There is no labeled cluster issuers, check if there is only one configured
          clusterIssuers = await this.kubeHelper.listClusterIssuers()
          if (clusterIssuers.length === 1) {
            // Using the cluster issuer
            ctx.clusterIssuersName = clusterIssuers[0].metadata.name
            task.title = `${task.title}...[Found: ${ctx.clusterIssuersName}]`
            return
          }

          ctx.clusterIssuersName = DEFAULT_CHE_CLUSTER_ISSUER_NAME
          const cheClusterIssuerExists = await this.kubeHelper.isClusterIssuerExists(DEFAULT_CHE_CLUSTER_ISSUER_NAME)
          if (!cheClusterIssuerExists) {
            const cheCertificateClusterIssuerTemplatePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'che-cluster-issuer.yml')
            await this.kubeHelper.createClusterIssuerFromFile(cheCertificateClusterIssuerTemplatePath)

            task.title = `${task.title}...[OK]`
          } else {
            task.title = `${task.title}...[Exists]`
          }
        },
      },
    ]
  }

  getGenerateCertificatesTasks(
    flags: any,
    commonName: string,
    dnsNames: string[],
    secretName: string,
    namespace: string): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: `Request certificate for dnsNames: [${dnsNames}]`,
        task: async (ctx: any, task: any) => {
          if (ctx.cheCertificateExists) {
            throw new Error('Eclipse Che certificate already exists.')
          }
          if (ctx.clusterIssuersName === DEFAULT_CHE_CLUSTER_ISSUER_NAME) {
            task.title = 'Request self-signed certificate'
          }

          const certificateTemplatePath = path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'cert-manager', 'che-certificate.yml')
          const certificate = this.kubeHelper.safeLoadFromYamlFile(certificateTemplatePath) as V1Certificate
          certificate.metadata.namespace = namespace
          certificate.spec.secretName = secretName
          certificate.spec.commonName = commonName
          certificate.spec.dnsNames = dnsNames
          certificate.spec.issuerRef.name = ctx.clusterIssuersName

          await this.kubeHelper.createCertificate(certificate, namespace)
          ctx.cheCertificateExists = true

          task.title = `${task.title}...[OK]`
        },
      },
      {
        title: 'Wait for certificate',
        task: async (ctx: any, task: any) => {
          if (ctx.clusterIssuersName === DEFAULT_CHE_CLUSTER_ISSUER_NAME) {
            task.title = 'Wait for self-signed certificate'
          }
          await this.kubeHelper.waitSecret(secretName, namespace, ['tls.key', 'tls.crt', 'ca.crt'])
          task.title = `${task.title}...[OK]`
        },
      },
    ]
  }

  getRetrieveCheCACertificate(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Retrieving Che CA certificate',
        task: async (ctx: any, task: any) => {
          if (ctx.clusterIssuersName === DEFAULT_CHE_CLUSTER_ISSUER_NAME) {
            task.title = 'Retrieving Che self-signed CA certificate'
          }

          const cheSecret = await this.kubeHelper.getSecret(CHE_TLS_SECRET_NAME, flags.chenamespace)
          if (cheSecret && cheSecret.data) {
            const cheCaCrt = base64Decode(cheSecret.data['ca.crt'])
            const caCertFilePath = path.join(os.tmpdir(), DEFAULT_CA_CERT_FILE_NAME)
            fs.writeFileSync(caCertFilePath, cheCaCrt)

            // We need to put self-signed CA certificate separately into CHE_ROOT_CA_SECRET_NAME secret
            await this.kubeHelper.createSecret(CHE_ROOT_CA_SECRET_NAME, flags.chenamespace, { 'ca.crt': cheCaCrt })

            const serverStrategy = await this.kubeHelper.getConfigMapValue('che', flags.chenamespace, 'CHE_INFRA_KUBERNETES_SERVER__STRATEGY')
            if (serverStrategy !== 'single-host') {
              ctx.highlightedMessages.push(getMessageImportCaCertIntoBrowser(caCertFilePath))
            }
            task.title = `${task.title}... [OK]`
          } else {
            throw new Error('Failed to get Cert Manager CA secret')
          }
        },
      },
    ]
  }
}
