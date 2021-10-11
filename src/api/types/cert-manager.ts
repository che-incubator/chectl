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

import { V1ObjectMeta } from '@kubernetes/client-node'

export interface V1Certificate {
  apiVersion: string
  kind: string
  metadata: V1ObjectMeta
  spec: V1CertificateSpec
}

export interface V1CertificateSpec {
  secretName: string
  issuerRef: V1CertificateSpecIssuerReference
  commonName: string
  dnsNames: string[]
}

export interface V1CertificateSpecIssuerReference {
  name: string
  kind: string
}
