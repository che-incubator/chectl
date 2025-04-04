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

import { V1ConfigMap, V1Ingress, V1Namespace, V1ObjectMeta, V1Secret } from '@kubernetes/client-node'
import { ux } from '@oclif/core'
import * as crypto from 'node:crypto'
import * as fs from 'fs-extra'
import * as yaml from 'js-yaml'
import * as Listr from 'listr'
import { merge } from 'lodash'
import * as os from 'node:os'
import * as path from 'node:path'
import { CheCtlContext, DexContext, EclipseCheContext, OIDCContext } from '../../context'
import { KubeClient } from '../../api/kube-client'
import { base64Decode, getEmbeddedTemplatesDirectory, newListr, safeLoadFromYamlFile } from '../../utils/utls'
import { V1Certificate } from '../../api/types/cert-manager'
import { Installer } from './installer'
import { CHE_NAMESPACE_FLAG, DOMAIN_FLAG } from '../../flags'
import { PlatformTasks } from '../platforms/platform-tasks'
import { CommonTasks } from '../common-tasks'

namespace TemplatePlaceholders {
  export const DOMAIN = '{{DOMAIN}}'
  export const CHE_NAMESPACE = '{{NAMESPACE}}'
  export const CLIENT_ID = '{{CLIENT_ID}}'
  export const CLIENT_SECRET = '{{CLIENT_SECRET}}'
  export const DEX_PASSWORD_HASH = '{{DEX_PASSWORD_HASH}}'
}

export namespace Dex {
  export const CONFIG_MAP = 'dex-ca'
  export const CONFIG_MAP_LABELS = { 'app.kubernetes.io/part-of': 'che.eclipse.org', 'app.kubernetes.io/component': 'ca-bundle' }
}

export class DexInstaller implements Installer {
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

  protected kubeClient: KubeClient

  constructor() {
    this.kubeClient = KubeClient.getInstance()
  }

  getDeployTasks(): Listr.ListrTask<any> {
    return {
      title: 'Install Dex',
      task: async (ctx: any, _task: any) => {
        const tasks = newListr([], true)
        tasks.add({
          title: `Create Namespace ${DexInstaller.NAMESPACE_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.getNamespace(DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('namespace.yaml')
              const namespace = safeLoadFromYamlFile(yamlFilePath) as V1Namespace
              await this.kubeClient.createNamespace(namespace)
              await this.kubeClient.waitNamespaceActive(DexInstaller.NAMESPACE_NAME)
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: 'Create Certificates',
          task: async (_ctx: any, task: any) => {
            const dexCaCertificateFilePath = this.getDexCaCertificateFilePath()

            if (await this.kubeClient.isSecretExists(DexInstaller.TLS_SECRET_NAME, DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists: ${dexCaCertificateFilePath}]`
            } else {
              let yamlFilePath = this.getDexResourceFilePath('selfsigned-issuer.yaml')
              const saIssuer = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createIssuer(saIssuer, DexInstaller.NAMESPACE_NAME)

              yamlFilePath = this.getDexResourceFilePath('selfsigned-certificate.yaml')
              const saCertificate = safeLoadFromYamlFile(yamlFilePath) as V1Certificate
              await this.kubeClient.createCertificate(saCertificate, DexInstaller.NAMESPACE_NAME)
              await this.kubeClient.waitSecret('ca.crt', DexInstaller.NAMESPACE_NAME)

              yamlFilePath = this.getDexResourceFilePath('issuer.yaml')
              const issuer = yaml.load(fs.readFileSync(yamlFilePath).toString())
              await this.kubeClient.createIssuer(issuer, DexInstaller.NAMESPACE_NAME)

              yamlFilePath = this.getDexResourceFilePath('certificate.yaml')
              const certificate = yaml.load(fs.readFileSync(yamlFilePath).toString()) as V1Certificate
              const flags = CheCtlContext.getFlags()
              const dexDomain = 'dex.' + flags[DOMAIN_FLAG]
              const wildCardDexDomain = '*.' + dexDomain
              certificate.spec.dnsNames = [dexDomain, wildCardDexDomain]
              await this.kubeClient.createCertificate(certificate, DexInstaller.NAMESPACE_NAME)
              await this.kubeClient.waitSecret(DexInstaller.TLS_SECRET_NAME, DexInstaller.NAMESPACE_NAME)
              task.title = `${task.title}...[Created: ${dexCaCertificateFilePath}]`
            }

            const secret = await this.kubeClient.getSecret(DexInstaller.TLS_SECRET_NAME, DexInstaller.NAMESPACE_NAME)
            if (secret && secret.data) {
              ctx[DexContext.DEX_CA_CRT] = base64Decode(secret.data['ca.crt'])
              fs.writeFileSync(dexCaCertificateFilePath, ctx[DexContext.DEX_CA_CRT])
            } else {
              throw new Error(`Dex certificate not found in the secret '${DexInstaller.TLS_SECRET_NAME}' in the namespace '${DexInstaller.NAMESPACE_NAME}'.`)
            }
          },
        })
        tasks.add({
          title: `Create ConfigMap ${Dex.CONFIG_MAP}`,
          task: async (ctx: any, task: any) => {
            const flags = CheCtlContext.getFlags()
            const dexCa = new V1ConfigMap()
            dexCa.metadata = new V1ObjectMeta()
            dexCa.metadata.name = Dex.CONFIG_MAP
            dexCa.metadata.labels = Dex.CONFIG_MAP_LABELS
            dexCa.data = { 'ca.crt': ctx[DexContext.DEX_CA_CRT] }

            if (await this.kubeClient.isConfigMapExists(Dex.CONFIG_MAP, flags[CHE_NAMESPACE_FLAG])) {
              await this.kubeClient.replaceConfigMap(Dex.CONFIG_MAP, dexCa, flags[CHE_NAMESPACE_FLAG])
              task.title = `${task.title}...[Updated]`
            } else {
              await this.kubeClient.createConfigMap(dexCa, flags[CHE_NAMESPACE_FLAG])
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: `Create ServiceAccount ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isServiceAccountExist(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('service-account.yaml')
              const serviceAccount = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createServiceAccount(serviceAccount, DexInstaller.NAMESPACE_NAME)
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: `Create ClusterRole ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isClusterRoleExist(DexInstaller.DEX_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('cluster-role.yaml')
              const clusterRole = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createClusterRole(clusterRole)
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: `Create ClusterRoleBinding ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isClusterRoleBindingExist(DexInstaller.DEX_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('cluster-role-binding.yaml')
              const clusterRoleBinding = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createClusterRoleBinding(clusterRoleBinding)
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: `Create Service ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isServiceExists(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('service.yaml')
              const service = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createService(service, DexInstaller.NAMESPACE_NAME)
              task.title = `${task.title}...[Created]`
            }

            // set service in a CR
            ctx[EclipseCheContext.CR_PATCH] = ctx[EclipseCheContext.CR_PATCH] || {}
            merge(ctx[EclipseCheContext.CR_PATCH], { spec: { networking: { auth: { identityProviderURL: 'http://dex.dex:5556' } } } })
          },
        })
        tasks.add({
          title: `Create Ingress ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isIngressExist(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const flags = CheCtlContext.getFlags()
              const yamlFilePath = this.getDexResourceFilePath('ingress.yaml')
              let yamlContent = fs.readFileSync(yamlFilePath).toString()
              yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), flags[DOMAIN_FLAG])

              const ingress = yaml.load(yamlContent) as V1Ingress
              await this.kubeClient.createIngress(ingress, DexInstaller.NAMESPACE_NAME)

              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: 'Generate Dex username and password',
          task: async (ctx: any, task: any) => {
            const dexConfigMap = await this.kubeClient.getConfigMap(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)
            if (dexConfigMap && dexConfigMap.data) {
              task.title = `${task.title}...[Exists]`
            } else {
              ctx[DexContext.DEX_USERNAME] = DexInstaller.DEX_USERNAME
              ctx[DexContext.DEX_PASSWORD] = DexInstaller.DEX_PASSWORD
              ctx[DexContext.DEX_PASSWORD_HASH] = DexInstaller.DEX_PASSWORD_HASH

              // create a secret to store credentials
              const dexCa = new V1Secret()
              dexCa.metadata = new V1ObjectMeta()
              dexCa.metadata.name = DexInstaller.CREDENTIALS_SECRET_NAME
              dexCa.data = { user: DexInstaller.DEX_USERNAME, password: DexInstaller.DEX_PASSWORD }
              await this.kubeClient.createSecret(dexCa, DexInstaller.NAMESPACE_NAME)

              task.title = `${task.title}...[OK: ${ctx[DexContext.DEX_USERNAME]}:${ctx[DexContext.DEX_PASSWORD]}]`
            }
          },
        })
        tasks.add({
          title: `Create ConfigMap ${DexInstaller.DEX_NAME}`,
          task: async (ctx: any, task: any) => {
            const dexConfigMap = await this.kubeClient.getConfigMap(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)
            if (dexConfigMap && dexConfigMap.data) {
              // read client secret
              const configYamlData = dexConfigMap.data['config.yaml']
              if (!configYamlData) {
                throw new Error(`'config.yaml' not defined in the configmap '${DexInstaller.DEX_NAME}' in the namespace '${DexInstaller.NAMESPACE_NAME}'`)
              }

              const config = yaml.load(configYamlData) as any
              const eclipseCheClient = (config.staticClients as Array<any>).find(client => client.id === DexInstaller.CLIENT_ID)
              if (!eclipseCheClient) {
                ux.error(`'${DexInstaller.CLIENT_ID}' client not found in the configmap '${DexInstaller.DEX_NAME}' in the namespace '${DexInstaller.NAMESPACE_NAME}'.`, { exit: 1 })
              }

              // set in a CR
              ctx[EclipseCheContext.CR_PATCH] = ctx[EclipseCheContext.CR_PATCH] || {}
              merge(ctx[EclipseCheContext.CR_PATCH], { spec: { networking: { auth: { oAuthClientName: DexInstaller.CLIENT_ID, oAuthSecret: eclipseCheClient.secret } } } })

              task.title = `${task.title}...[Exists]`
            } else {
              const flags = CheCtlContext.getFlags()
              const yamlFilePath = this.getDexResourceFilePath('configmap.yaml')
              let yamlContent = fs.readFileSync(yamlFilePath).toString()
              yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DOMAIN, 'g'), flags[DOMAIN_FLAG])
              yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_ID, 'g'), DexInstaller.CLIENT_ID)
              // generate client secret
              let clientSecret = crypto.randomBytes(32).toString('base64')
              clientSecret = 'EclipseChe'
              yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.CLIENT_SECRET, 'g'), clientSecret)

              yamlContent = yamlContent.replace(new RegExp(TemplatePlaceholders.DEX_PASSWORD_HASH, 'g'), ctx[DexContext.DEX_PASSWORD_HASH])

              const configMap = yaml.load(yamlContent) as V1ConfigMap
              await this.kubeClient.createConfigMap(configMap, DexInstaller.NAMESPACE_NAME)

              // set in a CR
              merge(ctx[EclipseCheContext.CR_PATCH], { spec: { networking: { auth: { oAuthClientName: DexInstaller.CLIENT_ID, oAuthSecret: clientSecret } } } })

              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: `Create Deployment ${DexInstaller.DEX_NAME}`,
          task: async (_ctx: any, task: any) => {
            if (await this.kubeClient.isDeploymentExist(DexInstaller.DEX_NAME, DexInstaller.NAMESPACE_NAME)) {
              task.title = `${task.title}...[Exists]`
            } else {
              const yamlFilePath = this.getDexResourceFilePath('deployment.yaml')
              const deployment = safeLoadFromYamlFile(yamlFilePath)
              await this.kubeClient.createDeployment(deployment, DexInstaller.NAMESPACE_NAME)
              await this.kubeClient.waitForPodReady(DexInstaller.SELECTOR, DexInstaller.NAMESPACE_NAME)
              task.title = `${task.title}...[Created]`
            }
          },
        })
        tasks.add({
          title: 'Configure API server',
          task: async (ctx: any) => {
            const flags = CheCtlContext.getFlags()
            const tasks = newListr()
            ctx[OIDCContext.CLIENT_ID] = DexInstaller.CLIENT_ID
            ctx[OIDCContext.ISSUER_URL] = `https://dex.${flags[DOMAIN_FLAG]}`
            ctx[OIDCContext.CA_FILE] = this.getDexCaCertificateFilePath()
            tasks.add(PlatformTasks.getConfigureApiServerForDexTasks())
            return tasks
          },
        })
        return tasks
      },
    }
  }

  getDexCaCertificateFilePath(): string {
    return path.join(os.tmpdir(), DexInstaller.CA_CERTIFICATE_FILENAME)
  }

  getDexResourceFilePath(fileName: string): string {
    return path.join(getEmbeddedTemplatesDirectory(), '..', 'resources', 'dex', fileName)
  }

  getPreUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getUpdateTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }

  getDeleteTasks(): Listr.ListrTask<any> {
    return CommonTasks.getDisabledTask()
  }
}
