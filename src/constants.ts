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

export const DSC_PROJECT_NAME = 'dsc'
export const CHECTL_PROJECT_NAME = 'chectl'
export const CHE_FLAVOR = 'che'
export const CHE_OPERATOR_TEMPLATE_DIR = 'che-operator'
export const DEVWORKSPACE_OPERATOR_TEMPLATE_DIR = 'devworkspace-operator'

// images
export const OPERATOR_IMAGE_NAME = 'quay.io/eclipse/che-operator'
export const OPERATOR_IMAGE_NEXT_TAG = 'next'
export const ECLIPSE_CHE_NEXT_CATALOG_SOURCE_IMAGE = 'quay.io/eclipse/eclipse-che-openshift-opm-catalog:next'
export const DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:next'
export const DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:release'

// tls
export const CERT_MANAGER_NAMESPACE_NAME = 'cert-manager'
export const CHE_TLS_SECRET_NAME = 'che-tls'
export const CHE_ROOT_CA_SECRET_NAME = 'self-signed-certificate'
export const DEFAULT_CA_CERT_FILE_NAME = 'cheCA.crt'

// operator
export const OPERATOR_DEPLOYMENT_NAME = 'che-operator'
export const CHE_OPERATOR_SELECTOR = 'app=che-operator'

export const DEFAULT_CHE_NAMESPACE = 'eclipse-che'

// Eclipse Che OLM
export const OLM_STABLE_CHANNEL_NAME = 'stable'
export const ECLIPSE_CHE_STABLE_CHANNEL_PACKAGE_NAME = 'eclipse-che'
export const ECLIPSE_CHE_STABLE_CHANNEL_CATALOG_SOURCE_NAME = 'community-operators'

export const OLM_NEXT_CHANNEL_NAME = 'next'
export const ECLIPSE_CHE_NEXT_CHANNEL_PACKAGE_NAME = 'eclipse-che-preview-openshift'
export const ECLIPSE_CHE_NEXT_CHANNEL_CATALOG_SOURCE_NAME = 'eclipse-che-preview'

export const DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME = 'eclipse-che-subscription'
export const CSV_PREFIX = 'eclipse-che'

export const OPENSHIFT_MARKET_PLACE_NAMESPACE = 'openshift-marketplace'
export const OPENSHIFT_OPERATORS_NAMESPACE = 'openshift-operators'

export const DEFAULT_CUSTOM_CATALOG_SOURCE_NAME = 'eclipse-che-custom-catalog-source'

// DevWorkspace
export const NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR = 'custom-devworkspace-operator-catalog'
export const STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR = 'stable-custom-devworkspace-operator-catalog'
export const WORKSPACE_CONTROLLER_NAMESPACE = 'devworkspace-controller'
export const DEVWORKSPACE_CSV_PREFIX = 'devworkspace-operator'

// Documentation links
export const DOC_LINK = 'https://www.eclipse.org/che/docs/'
export const DOC_LINK_RELEASE_NOTES = ''
export const DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER = 'https://www.eclipse.org/che/docs/che-7/end-user-guide/importing-certificates-to-browsers/'
export const DOC_LINK_CONFIGURE_API_SERVER = 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/#configuring-the-api-server'

export const OUTPUT_SEPARATOR = '-------------------------------------------------------------------------------'

// HOOKS
export const DEFAULT_ANALYTIC_HOOK_NAME = 'analytics'

// Timeouts
export const DEFAULT_K8S_POD_WAIT_TIMEOUT = 600000
export const DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT = 1200000
export const DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT = 60000

// Custom Resources names
export const CHE_CLUSTER_CRD = 'checlusters.org.eclipse.che'
export const CHE_CLUSTER_API_GROUP = 'org.eclipse.che'
export const CHE_CLUSTER_API_VERSION_V2 = 'v2'
export const CHE_CLUSTER_KIND_PLURAL = 'checlusters'

export const DEVFILE_WORKSPACE_API_GROUP = 'workspace.devfile.io'
export const DEVFILE_WORKSPACE_API_VERSION = 'v1alpha1'
export const DEVFILE_WORKSPACE_KIND_PLURAL = 'devworkspaces'

export const DEVFILE_WORKSPACE_ROUTINGS_API_GROUP = 'controller.devfile.io'
export const DEVFILE_WORKSPACE_ROUTINGS_VERSION = 'v1alpha1'
export const DEVFILE_WORKSPACE_ROUTINGS_KIND_PLURAL = 'devworkspaceroutings'
