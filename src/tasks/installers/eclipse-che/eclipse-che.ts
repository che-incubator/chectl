/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

export namespace EclipseChe {
  export const CHE_FLAVOR = 'che'
  export const PRODUCT_ID = 'eclipse-che'
  export const PRODUCT_NAME = 'Eclipse Che'

  // Resources
  export const NAMESPACE = 'eclipse-che'
  export const OPERATOR_SERVICE = `${CHE_FLAVOR}-operator-service`
  export const OPERATOR_SERVICE_CERT_SECRET = `${CHE_FLAVOR}-operator-service-cert`
  export const OPERATOR_SERVICE_ACCOUNT = `${CHE_FLAVOR}-operator`
  export const K8S_CERTIFICATE = 'che-operator-serving-cert'
  export const K8S_ISSUER = 'che-operator-selfsigned-issuer'
  export const VALIDATING_WEBHOOK = 'org.eclipse.che'
  export const MUTATING_WEBHOOK = 'org.eclipse.che'
  export const CONFIG_MAP = 'che'
  export const PLUGIN_REGISTRY_CONFIG_MAP = 'plugin-registry'
  export const CONSOLE_LINK = 'che'
  export const PROMETHEUS = 'prometheus-k8s'
  export const IMAGE_CONTENT_SOURCE_POLICY = 'quay.io'

  // API
  export const CHE_CLUSTER_CRD = 'checlusters.org.eclipse.che'
  export const CHE_CLUSTER_API_GROUP = 'org.eclipse.che'
  export const CHE_CLUSTER_API_VERSION_V2 = 'v2'
  export const CHE_CLUSTER_KIND_PLURAL = 'checlusters'

  // OLM
  export const PACKAGE = PRODUCT_ID
  export const STABLE_CHANNEL = 'stable'
  export const STABLE_CHANNEL_CATALOG_SOURCE = 'community-operators'
  export const STABLE_CATALOG_SOURCE_IMAGE = 'quay.io/eclipse/eclipse-che-olm-catalog:stable'
  export const NEXT_CHANNEL = 'next'
  export const NEXT_CHANNEL_CATALOG_SOURCE = PRODUCT_ID
  export const NEXT_CATALOG_SOURCE_IMAGE = 'quay.io/eclipse/eclipse-che-olm-catalog:next'
  export const SUBSCRIPTION = PRODUCT_ID
  export const CSV_PREFIX = PRODUCT_ID
  export const APPROVAL_STRATEGY_MANUAL = 'Manual'
  export const APPROVAL_STRATEGY_AUTOMATIC = 'Automatic'

  // TLS
  export const CHE_TLS_SECRET_NAME = 'che-tls'
  export const SELF_SIGNED_CERTIFICATE = 'self-signed-certificate'
  export const DEFAULT_CA_CERT_FILE_NAME = 'cheCA.crt'

  // Operator image
  export const OPERATOR_IMAGE_NAME = 'quay.io/eclipse/che-operator'
  export const OPERATOR_IMAGE_NEXT_TAG = 'next'

  // Doc links
  export const DOC_LINK = 'https://www.eclipse.org/che/docs/'
  export const DOC_LINK_RELEASE_NOTES = ''
  export const DOC_LINK_CONFIGURE_API_SERVER = 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/#configuring-the-api-server'

  // Components
  export const CHE_SERVER = `${PRODUCT_NAME} Server`
  export const DASHBOARD = 'Dashboard'
  export const GATEWAY = 'Gateway'
  export const DEVFILE_REGISTRY = 'Devfile Registry'
  export const PLUGIN_REGISTRY = 'Plugin Registry'
  export const CHE_OPERATOR = `${PRODUCT_NAME} Operator`

  // Deployments
  export const OPERATOR_DEPLOYMENT_NAME = `${CHE_FLAVOR}-operator`
  export const CHE_SERVER_DEPLOYMENT_NAME = `${CHE_FLAVOR}`
  export const DASHBOARD_DEPLOYMENT_NAME = `${CHE_FLAVOR}-dashboard`
  export const GATEWAY_DEPLOYMENT_NAME = 'che-gateway'
  export const DEVFILE_REGISTRY_DEPLOYMENT_NAME = 'devfile-registry'
  export const PLUGIN_REGISTRY_DEPLOYMENT_NAME = 'plugin-registry'

  // Selectors
  export const CHE_OPERATOR_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=${CHE_FLAVOR}-operator`
  export const CHE_SERVER_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=${CHE_FLAVOR}`
  export const DASHBOARD_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=${CHE_FLAVOR}-dashboard`
  export const DEVFILE_REGISTRY_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=devfile-registry`
  export const PLUGIN_REGISTRY_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=plugin-registry`
  export const GATEWAY_SELECTOR = `app.kubernetes.io/name=${CHE_FLAVOR},app.kubernetes.io/component=che-gateway`
}
