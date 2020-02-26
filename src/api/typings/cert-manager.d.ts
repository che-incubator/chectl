/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export interface V1alpha2Certificate {
  apiVersion: string
  kind: string
  metadata: V1ObjectMeta
  spec: V1alpha2CertificateSpec
}

export interface V1alpha2CertificateSpec {
  secretName: string
  issuerRef: V1alpha2CertificateSpecIssuerReference
  commonName: string
  dnsNames: List<string>
}

export interface V1alpha2CertificateSpecIssuerReference {
  name: string
  kind: string
}
