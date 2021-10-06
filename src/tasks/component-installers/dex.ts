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

import { V1ConfigMap, V1Ingress, V1ObjectMeta } from '@kubernetes/client-node'
import * as bcrypt from 'bcrypt'
import { cli } from 'cli-ux'
import * as crypto from 'crypto'
import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import { merge } from 'lodash'
import * as os from 'os'
import * as path from 'path'
import { CheHelper } from '../../api/che'
import { ChectlContext, DexContextKeys, OIDCContextKeys } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { base64Decode, generatePassword, getEmbeddedTemplatesDirectory, getTlsSecretName } from '../../util'
import { PlatformTasks } from '../platforms/platform'
import { CertManagerTasks } from './cert-manager'

namespace TemplatePlaceholders {
  export const DOMAIN = '{{DOMAIN}}'
  export const CHE_NAMESPACE = '{{NAMESPACE}}'
  export const CLIENT_ID = '{{CLIENT_ID}}'
  export const CLIENT_SECRET = '{{CLIENT_SECRET}}'
  export const DEX_PASSWORD_HASH = '{{DEX_PASSWORD_HASH}}'
}

namespace DexCaConfigMap {
  export const NAME = 'dex-ca'
  export const LABELS = { 'app.kubernetes.io/part-of': 'che.eclipse.org', 'app.kubernetes.io/component': 'ca-bundle' }
}

export class DexTasks {
  protected clientId = 'eclipse-che'

  protected dexName = 'dex'

  protected namespaceName = 'dex'

  protected tlsSecretName = 'dex.tls'

  protected caCertificateFileName = 'dex-ca.crt'

  protected selector = 'app=dex'

  protected kube: KubeHelper

  protected che: CheHelper

  protected platform: PlatformTasks

  constructor(private readonly flags: any) {
    this.kube = new KubeHelper(flags)
    this.che = new CheHelper(flags)
    this.platform = new PlatformTasks(flags)
  }

  getInstallTasks(): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: 'Deploy Dex',
        task: async (ctx: any, _task: any) => {
          return new Listr([
            {
              title: 'Create Dex namespace',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.getNamespace(this.namespaceName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('namespace.yaml')
                  await this.kube.createNamespaceFromFile(yamlFilePath)
                  await this.kube.waitNamespaceActive(this.namespaceName)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Provide Dex certificate',
              task: async (ctx: any) => {
                const certs = new Listr(undefined, ctx.listrOptions)

                if (getTlsSecretName(ctx) === '') {
                  // Eclipse Che will use a default k8s certificate.
                  // No need to generate something for dex
                  certs.add([{
                    title: 'Use default k8s certificate',
                    task: async (_ctx: any, task: any) => {
                      task.title = `${task.title}...[OK]`
                    },
                  }])
                  return certs
                }

                if (!await this.kube.getSecret(this.tlsSecretName, this.namespaceName)) {
                  const certManager = new CertManagerTasks(this.flags)
                  certs.add(certManager.getDeployCertManagerTasks(this.flags))
                  certs.add(certManager.getGenerateCertManagerCACertificateTasks(this.flags))
                  certs.add(certManager.getCreateCertificateIssuerTasks(this.flags))

                  const domain = 'dex.' + this.flags.domain
                  const commonName = '*.' + domain
                  const dnsNames = [domain, commonName]
                  certs.add(certManager.getGenerateCertificatesTasks(this.flags, commonName, dnsNames, this.tlsSecretName, this.namespaceName))
                }

                certs.add([{
                  title: 'Read Dex certificate',
                  task: async (ctx: any, task: any) => {
                    const secret = await this.kube.getSecret(this.tlsSecretName, this.namespaceName)
                    if (secret && secret.data) {
                      ctx[DexContextKeys.DEX_CA_CRT] = base64Decode(secret.data['ca.crt'])
                      task.title = `${task.title}...[OK]`
                    } else {
                      throw new Error(`Dex certificate not found in the secret '${this.tlsSecretName}' in the namespace '${this.namespaceName}'.`)
                    }
                  },
                },
                {
                  title: 'Save Dex certificate',
                  task: async (ctx: any, task: any) => {
                    const dexCaCertificateFilePath = this.getDexCaCertificateFilePath()
                    fs.writeFileSync(dexCaCertificateFilePath, ctx[DexContextKeys.DEX_CA_CRT])
                    task.title = `${task.title}...[OK: ${dexCaCertificateFilePath}]`
                  },
                },
                {
                  title: 'Add Dex certificate to Eclipse Che certificates bundle',
                  task: async (ctx: any, task: any) => {
                    if (await this.kube.isConfigMapExists(DexCaConfigMap.NAME, this.flags.chenamespace)) {
                      task.title = `${task.title}...[Exists]`
                    } else {
                      const dexCa = new V1ConfigMap()
                      dexCa.metadata = new V1ObjectMeta()
                      dexCa.metadata.name = DexCaConfigMap.NAME
                      dexCa.metadata.labels = DexCaConfigMap.LABELS
                      dexCa.data = { 'ca.crt': ctx[DexContextKeys.DEX_CA_CRT] }

                      await this.kube.createNamespacedConfigMap(this.flags.chenamespace, dexCa)
                      task.title = `${task.title}...[OK]`
                    }
                  },
                }])

                return certs
              },
            },
            {
              title: 'Create Dex service account',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isServiceAccountExist(this.dexName, this.namespaceName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('service-account.yaml')
                  await this.kube.createServiceAccountFromFile(yamlFilePath, this.namespaceName)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex cluster role',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isClusterRoleExist(this.dexName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('cluster-role.yaml')
                  await this.kube.createClusterRoleFromFile(yamlFilePath)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex cluster role binding',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isClusterRoleBindingExist(this.dexName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('cluster-role-binding.yaml')
                  await this.kube.createClusterRoleBindingRoleFromFile(yamlFilePath)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex service',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isServiceExists(this.dexName, this.namespaceName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('service.yaml')
                  await this.kube.createServiceFromFile(yamlFilePath, this.namespaceName)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex ingress',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isIngressExist(this.dexName, this.namespaceName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('ingress.yaml')
                  let yamlContent = fs.readFileSync(yamlFilePath).toString()
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), this.flags.domain)

                  const ingress = yaml.load(yamlContent) as V1Ingress
                  await this.kube.createIngressFromObj(ingress, this.namespaceName)

                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Generate Dex username and password',
              task: async (ctx: any, task: any) => {
                const dexConfigMap = await this.kube.getConfigMap(this.dexName, this.namespaceName)
                if (dexConfigMap && dexConfigMap.data) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const dexPassword = generatePassword(12)

                  const salt = bcrypt.genSaltSync(10)
                  const dexPasswordHash = bcrypt.hashSync(dexPassword, salt)

                  ctx[DexContextKeys.DEX_USERNAME] = 'admin'
                  ctx[DexContextKeys.DEX_PASSWORD] = dexPassword
                  ctx[DexContextKeys.DEX_PASSWORD_HASH] = dexPasswordHash

                  task.title = `${task.title}...[OK: ${ctx[DexContextKeys.DEX_USERNAME]}:${ctx[DexContextKeys.DEX_PASSWORD]}]`
                }
              },
            },
            {
              title: 'Create Dex configmap',
              task: async (ctx: any, task: any) => {
                const dexConfigMap = await this.kube.getConfigMap(this.dexName, this.namespaceName)
                if (dexConfigMap && dexConfigMap.data) {
                  // read client secret
                  const config = yaml.load(dexConfigMap.data['config.yaml']) as any
                  if (!config) {
                    throw new Error(`'config.yaml' not defined in the configmap '${this.dexName}' in the namespace '${this.namespaceName}'`)
                  }

                  const eclipseCheClient = (config.staticClients as Array<any>).find(client => client.id === this.clientId)
                  if (!eclipseCheClient) {
                    cli.error(`'${this.clientId}' client not found in the configmap '${this.dexName}' in the namespace '${this.namespaceName}'.`)
                  }

                  // set in a CR
                  ctx[ChectlContext.CR_PATCH] = ctx[ChectlContext.CR_PATCH] || {}
                  merge(ctx[ChectlContext.CR_PATCH], { spec: { auth: { oAuthClientName: this.clientId, oAuthSecret: eclipseCheClient.secret } } })

                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('configmap.yaml')
                  let yamlContent = fs.readFileSync(yamlFilePath).toString()
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), this.flags.domain)
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CHE_NAMESPACE, 'g'), this.flags.chenamespace)
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_ID, 'g'), this.clientId)
                  // generate client secret
                  const clientSecret = crypto.randomBytes(32).toString('base64')
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_SECRET, 'g'), clientSecret)

                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DEX_PASSWORD_HASH, 'g'), ctx[DexContextKeys.DEX_PASSWORD_HASH])

                  const configMap = yaml.load(yamlContent) as V1ConfigMap
                  await this.kube.createNamespacedConfigMap(this.namespaceName, configMap)

                  // set in a CR
                  merge(ctx[ChectlContext.CR_PATCH], { spec: { auth: { oAuthClientName: this.clientId, oAuthSecret: clientSecret } } })

                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex deployment',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isDeploymentExist(this.dexName, this.namespaceName)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('deployment.yaml')
                  await this.kube.createDeploymentFromFile(yamlFilePath, this.namespaceName)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Wait for Dex is ready',
              task: async (_ctx: any, task: any) => {
                await this.kube.waitForPodReady(this.selector, this.namespaceName)
                task.title = `${task.title}...[OK]`
              },
            },
            {
              title: 'Configure API server',
              task: async (ctx: any) => {
                ctx[OIDCContextKeys.CLIENT_ID] = this.clientId
                ctx[OIDCContextKeys.ISSUER_URL] = `https://dex.${this.flags.domain}`
                ctx[OIDCContextKeys.CA_FILE] = this.getDexCaCertificateFilePath()
                return new Listr(this.platform.configureApiServer(this.flags), ctx.listrOptions)
              },
            },
          ], ctx.listrOptions)
        },
      },
    ]
  }

  getDexCaCertificateFilePath(): string {
    return path.join(os.tmpdir(), this.caCertificateFileName)
  }

  getDexResourceFilePath(fileName: string): string {
    return path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'dex', fileName)
  }
}
