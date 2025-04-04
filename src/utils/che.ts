/**
 * Copyright (c) 2019-2024 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { CheCtlContext, EclipseCheContext, InfrastructureContext } from '../context'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'
import { KubeClient } from '../api/kube-client'
import { CHE_NAMESPACE_FLAG } from '../flags'
import { OpenShift } from './openshift'
import * as nodeforge from 'node-forge'
import { base64Decode } from './utls'
import { CheLogsReader } from '../api/che-logs-reader'

export namespace Che {
  export function isRedHatCatalogSources(catalogSourceName?: string): boolean {
    return catalogSourceName === 'community-operators' || catalogSourceName === 'redhat-operators'
  }
  export async function readPodLog(namespace: string, podLabelSelector: string | undefined, directory: string, follow: boolean): Promise<void> {
    const logsReader = new CheLogsReader()
    return logsReader.readPodLog(namespace, podLabelSelector, directory, follow)
  }

  export async function readNamespaceEvents(namespace: string, directory: string, follow: boolean): Promise<void> {
    const logsReader = new CheLogsReader()
    return logsReader.readNamespaceEvents(namespace, directory, follow)
  }

  export function getCheClusterFieldConfigured(fieldPath: string): any | undefined {
    const ctx = CheCtlContext.get()

    const cheClusterPatch = ctx[EclipseCheContext.CR_PATCH]
    const cheCluster = ctx[EclipseCheContext.CUSTOM_CR] || ctx[EclipseCheContext.DEFAULT_CR]

    for (const cr of [cheClusterPatch, cheCluster]) {
      // eslint-disable-next-line unicorn/no-array-reduce
      const fieldValue = fieldPath.split('.').reduce((acc, prop) => {
        return acc?.[prop]
      }, cr)

      if (fieldValue !== undefined) {
        return fieldValue
      }
    }
  }

  export async function getCheVersion(): Promise<string> {
    const kubeHelper = KubeClient.getInstance()
    const flags = CheCtlContext.getFlags()

    const cheCluster = await kubeHelper.getCheCluster(flags[CHE_NAMESPACE_FLAG])
    return cheCluster?.status?.cheVersion || 'NOT_FOUND'
  }

  export function buildDashboardURL(cheUrl: string): string {
    return cheUrl.endsWith('/') ? `${cheUrl}dashboard/` : `${cheUrl}/dashboard/`
  }

  export function getCheURL(namespace: string): Promise<string> {
    const ctx = CheCtlContext.get()
    return ctx[InfrastructureContext.IS_OPENSHIFT] ? getCheOpenShiftURL(namespace) : getCheK8sURL(namespace)
  }

  /**
   * Gets self-signed Che CA certificate from 'self-signed-certificate' secret.
   * If secret doesn't exist, undefined is returned.
   */
  export async function readCheCaCert(namespace: string): Promise<string | undefined> {
    const cheCaSecretContent = await getCheSelfSignedSecretContent(namespace)
    if (!cheCaSecretContent) {
      return
    }

    const pemBeginHeader = '-----BEGIN CERTIFICATE-----'
    const pemEndHeader = '-----END CERTIFICATE-----'
    const certRegExp = new RegExp(`(^${pemBeginHeader}$(?:(?!${pemBeginHeader}).)*^${pemEndHeader}$)`, 'mgs')
    const certsPem = cheCaSecretContent.match(certRegExp)

    const caCertsPem: string[] = []
    if (certsPem) {
      for (const certPem of certsPem) {
        const cert = nodeforge.pki.certificateFromPem(certPem)
        const basicConstraintsExt = cert.getExtension('basicConstraints')
        if (basicConstraintsExt && (basicConstraintsExt as any).cA) {
          caCertsPem.push(certPem)
        }
      }
    }

    return caCertsPem.join('\n')
  }

  /**
   * Retrieves content of Che self-signed-certificate secret or undefined if the secret doesn't exist.
   * Note, it contains certificate chain in pem format.
   */
  async function getCheSelfSignedSecretContent(namespace: string): Promise<string | undefined> {
    const kubeHelper = KubeClient.getInstance()

    const cheCaSecret = await kubeHelper.getSecret(EclipseChe.SELF_SIGNED_CERTIFICATE, namespace)
    if (!cheCaSecret) {
      return
    }

    if (cheCaSecret.data && cheCaSecret.data['ca.crt']) {
      return base64Decode(cheCaSecret.data['ca.crt'])
    }

    throw new Error(`Secret "${EclipseChe.SELF_SIGNED_CERTIFICATE}" has invalid format: "ca.crt" key not found in data.`)
  }

  async function getCheK8sURL(namespace: string): Promise<string> {
    const kubeHelper = KubeClient.getInstance()
    if (await kubeHelper.isIngressExist(EclipseChe.CHE_FLAVOR, namespace)) {
      const hostname = await kubeHelper.getIngressHost(EclipseChe.CHE_FLAVOR, namespace)
      return `https://${hostname}`
    }

    throw new Error(`Ingress ${EclipseChe.CHE_FLAVOR} not found`)
  }

  async function getCheOpenShiftURL(namespace: string): Promise<string> {
    if (await OpenShift.isRouteExist(`${EclipseChe.CHE_FLAVOR}`, namespace)) {
      const hostname = await OpenShift.getRouteHost(EclipseChe.CHE_FLAVOR, namespace)
      return `https://${hostname}`
    }

    throw new Error(`Route ${EclipseChe.CHE_FLAVOR} not found`)
  }
}
