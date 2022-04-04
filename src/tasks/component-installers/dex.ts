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
import { base64Decode, getEmbeddedTemplatesDirectory, getTlsSecretName, isCheClusterAPIV1 } from '../../util'
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
  private static readonly DEX_USERNAME = 'admin'

  private static readonly DEX_PASSWORD = 'admin'

  private static readonly DEX_PASSWORD_HASH = '$2a$12$Cnptj8keBvBFuQkNebteYuGHnZRNKT6MivLrGmFRaTxrlyfEAOrSa'

  private static readonly CLIENT_ID = 'eclipse-che'

  private static readonly DEX_NAME = 'dex'

  private static readonly NAMESPACE_NAME = 'dex'

  private static readonly TLS_SECRET_NAME = 'dex.tls'

  private static readonly CREDENTIALS_SECRET_NAME = 'dex-credentials'

  private static readonly CA_CERTIFICATE_FILENAME = 'dex-ca.crt'

  private static readonly SELECTOR = 'app=dex'

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
              title: `Create namespace: ${DexTasks.NAMESPACE_NAME}`,
              task: async (_ctx: any, task: any) => {
                if (await this.kube.getNamespace(DexTasks.NAMESPACE_NAME)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('namespace.yaml')
                  await this.kube.createNamespaceFromFile(yamlFilePath)
                  await this.kube.waitNamespaceActive(DexTasks.NAMESPACE_NAME)
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

                if (!await this.kube.getSecret(DexTasks.TLS_SECRET_NAME, DexTasks.NAMESPACE_NAME)) {
                  const certManager = new CertManagerTasks(this.flags)
                  certs.add(certManager.getDeployCertManagerTasks())
                  certs.add(certManager.getGenerateCertManagerCACertificateTasks())
                  certs.add(certManager.getCreateCertificateIssuerTasks())

                  const domain = 'dex.' + this.flags.domain
                  const commonName = '*.' + domain
                  const dnsNames = [domain, commonName]
                  certs.add(certManager.getGenerateCertificatesTasks(this.flags, commonName, dnsNames, DexTasks.TLS_SECRET_NAME, DexTasks.NAMESPACE_NAME))
                }

                certs.add([{
                  title: 'Read Dex certificate',
                  task: async (ctx: any, task: any) => {
                    const secret = await this.kube.getSecret(DexTasks.TLS_SECRET_NAME, DexTasks.NAMESPACE_NAME)
                    if (secret && secret.data) {
                      ctx[DexContextKeys.DEX_CA_CRT] = base64Decode(secret.data['ca.crt'])
                      task.title = `${task.title}...[OK]`
                    } else {
                      throw new Error(`Dex certificate not found in the secret '${DexTasks.TLS_SECRET_NAME}' in the namespace '${DexTasks.NAMESPACE_NAME}'.`)
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

                      await this.kube.createConfigMap(dexCa, this.flags.chenamespace)
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
                if (await this.kube.isServiceAccountExist(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('service-account.yaml')
                  await this.kube.createServiceAccountFromFile(yamlFilePath, DexTasks.NAMESPACE_NAME)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex cluster role',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isClusterRoleExist(DexTasks.DEX_NAME)) {
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
                if (await this.kube.isClusterRoleBindingExist(DexTasks.DEX_NAME)) {
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
                if (await this.kube.isServiceExists(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('service.yaml')
                  await this.kube.createServiceFromFile(yamlFilePath, DexTasks.NAMESPACE_NAME)
                  task.title = `${task.title}...[OK]`
                }

                // set service in a CR
                ctx[ChectlContext.CR_PATCH] = ctx[ChectlContext.CR_PATCH] || {}
                if (isCheClusterAPIV1(ctx[ChectlContext.DEFAULT_CR])) {
                  merge(ctx[ChectlContext.CR_PATCH], { spec: { auth: { identityProviderURL: 'http://dex.dex:5556' } } })
                } else {
                  merge(ctx[ChectlContext.CR_PATCH], { spec: { ingress: { auth: { identityProviderURL: 'http://dex.dex:5556' } } } })
                }
              },
            },
            {
              title: 'Create Dex ingress',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isIngressExist(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('ingress.yaml')
                  let yamlContent = fs.readFileSync(yamlFilePath).toString()
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), this.flags.domain)

                  const ingress = yaml.load(yamlContent) as V1Ingress
                  await this.kube.createIngress(ingress, DexTasks.NAMESPACE_NAME)

                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Generate Dex username and password',
              task: async (ctx: any, task: any) => {
                const dexConfigMap = await this.kube.getConfigMap(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)
                if (dexConfigMap && dexConfigMap.data) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  ctx[DexContextKeys.DEX_USERNAME] = DexTasks.DEX_USERNAME
                  ctx[DexContextKeys.DEX_PASSWORD] = DexTasks.DEX_PASSWORD
                  ctx[DexContextKeys.DEX_PASSWORD_HASH] = DexTasks.DEX_PASSWORD_HASH

                  // create a secret to store credentials
                  const credentials: any = { user: DexTasks.DEX_USERNAME, password: DexTasks.DEX_PASSWORD}
                  await this.kube.createSecret(DexTasks.CREDENTIALS_SECRET_NAME, DexTasks.NAMESPACE_NAME, credentials)

                  task.title = `${task.title}...[OK: ${ctx[DexContextKeys.DEX_USERNAME]}:${ctx[DexContextKeys.DEX_PASSWORD]}]`
                }
              },
            },
            {
              title: 'Create Dex configmap',
              task: async (ctx: any, task: any) => {
                const dexConfigMap = await this.kube.getConfigMap(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)
                if (dexConfigMap && dexConfigMap.data) {
                  // read client secret
                  const configYamlData = dexConfigMap.data['config.yaml']
                  if (!configYamlData) {
                    throw new Error(`'config.yaml' not defined in the configmap '${DexTasks.DEX_NAME}' in the namespace '${DexTasks.NAMESPACE_NAME}'`)
                  }

                  const config = yaml.load(configYamlData) as any
                  const eclipseCheClient = (config.staticClients as Array<any>).find(client => client.id === DexTasks.CLIENT_ID)
                  if (!eclipseCheClient) {
                    cli.error(`'${DexTasks.CLIENT_ID}' client not found in the configmap '${DexTasks.DEX_NAME}' in the namespace '${DexTasks.NAMESPACE_NAME}'.`)
                  }

                  // set in a CR
                  ctx[ChectlContext.CR_PATCH] = ctx[ChectlContext.CR_PATCH] || {}
                  if (isCheClusterAPIV1(ctx[ChectlContext.DEFAULT_CR])) {
                    merge(ctx[ChectlContext.CR_PATCH], { spec: { auth: { oAuthClientName: DexTasks.CLIENT_ID, oAuthSecret: eclipseCheClient.secret } } })
                  } else {
                    merge(ctx[ChectlContext.CR_PATCH], { spec: { ingress: { auth: { oAuthClientName: DexTasks.CLIENT_ID, oAuthSecret: eclipseCheClient.secret } } } })
                  }

                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('configmap.yaml')
                  let yamlContent = fs.readFileSync(yamlFilePath).toString()
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), this.flags.domain)
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_ID, 'g'), DexTasks.CLIENT_ID)
                  // generate client secret
                  const clientSecret = crypto.randomBytes(32).toString('base64')
                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_SECRET, 'g'), clientSecret)

                  yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DEX_PASSWORD_HASH, 'g'), ctx[DexContextKeys.DEX_PASSWORD_HASH])

                  const configMap = yaml.load(yamlContent) as V1ConfigMap
                  await this.kube.createConfigMap(configMap, DexTasks.NAMESPACE_NAME)

                  // set in a CR
                  if (isCheClusterAPIV1(ctx[ChectlContext.DEFAULT_CR])) {
                    merge(ctx[ChectlContext.CR_PATCH], { spec: { auth: { oAuthClientName: DexTasks.CLIENT_ID, oAuthSecret: clientSecret } } })
                  } else {
                    merge(ctx[ChectlContext.CR_PATCH], { spec: { ingress: { auth: { oAuthClientName: DexTasks.CLIENT_ID, oAuthSecret: clientSecret } } } })
                  }

                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Create Dex deployment',
              task: async (_ctx: any, task: any) => {
                if (await this.kube.isDeploymentExist(DexTasks.DEX_NAME, DexTasks.NAMESPACE_NAME)) {
                  task.title = `${task.title}...[Exists]`
                } else {
                  const yamlFilePath = this.getDexResourceFilePath('deployment.yaml')
                  await this.kube.createDeploymentFromFile(yamlFilePath, DexTasks.NAMESPACE_NAME)
                  task.title = `${task.title}...[OK]`
                }
              },
            },
            {
              title: 'Wait for Dex is ready',
              task: async (_ctx: any, task: any) => {
                await this.kube.waitForPodReady(DexTasks.SELECTOR, DexTasks.NAMESPACE_NAME)
                task.title = `${task.title}...[OK]`
              },
            },
            {
              title: 'Configure API server',
              task: async (ctx: any) => {
                ctx[OIDCContextKeys.CLIENT_ID] = DexTasks.CLIENT_ID
                ctx[OIDCContextKeys.ISSUER_URL] = `https://dex.${this.flags.domain}`
                ctx[OIDCContextKeys.CA_FILE] = this.getDexCaCertificateFilePath()
                return new Listr(this.platform.configureApiServerForDex(this.flags), ctx.listrOptions)
              },
            },
          ], ctx.listrOptions)
        },
      },
    ]
  }

  getDexCaCertificateFilePath(): string {
    return path.join(os.tmpdir(), DexTasks.CA_CERTIFICATE_FILENAME)
  }

  getDexResourceFilePath(fileName: string): string {
    return path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'dex', fileName)
  }
}
