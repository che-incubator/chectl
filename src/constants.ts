/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export const DEFAULT_CHE_IMAGE = 'quay.io/eclipse/che-server:7.12.1'
export const DEFAULT_CHE_OPERATOR_IMAGE = 'quay.io/eclipse/che-operator:7.12.1'

// This image should be updated manually when needed.
// Repository location: https://github.com/che-dockerfiles/che-cert-manager-ca-cert-generator-image
export const CA_CERT_GENERATION_JOB_IMAGE = 'quay.io/eclipse/che-cert-manager-ca-cert-generator:671342c'

export const CERT_MANAGER_NAMESPACE_NAME = 'cert-manager'
export const CHE_TLS_SECRET_NAME = 'che-tls'
export const CHE_CLUSTER_CR_NAME = 'eclipse-che'
