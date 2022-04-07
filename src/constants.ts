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

export const CHECTL_PROJECT_NAME = 'chectl'
export const OPERATOR_TEMPLATE_DIR = 'che-operator'

// minimal installable versions by current chectl
export const MIN_OLM_INSTALLER_VERSION = '7.17.0'
export const MIN_CHE_OPERATOR_INSTALLER_VERSION = '7.13.1'

// labels
export const CHE_RELATED_COMPONENT_LABEL = 'client/org.eclipse.che=true'

// images
export const DEFAULT_CHE_OPERATOR_IMAGE_NAME = 'quay.io/eclipse/che-operator'
// This image should be updated manually when needed.
// Repository location: https://github.com/che-dockerfiles/che-cert-manager-ca-cert-generator-image
export const CA_CERT_GENERATION_JOB_IMAGE = 'quay.io/eclipse/che-cert-manager-ca-cert-generator:671342c'
export const INDEX_IMG = 'quay.io/eclipse/eclipse-che-openshift-opm-catalog:next'
export const DEV_WORKSPACE_NEXT_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:next'
export const DEV_WORKSPACE_STABLE_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:release'

export const NEXT_TAG = 'next'

export const CERT_MANAGER_NAMESPACE_NAME = 'cert-manager'
export const CHE_TLS_SECRET_NAME = 'che-tls'
export const CHE_ROOT_CA_SECRET_NAME = 'self-signed-certificate'
export const DEFAULT_CA_CERT_FILE_NAME = 'cheCA.crt'
export const CHE_CLUSTER_CR_NAME = 'eclipse-che'

// operator
export const OPERATOR_DEPLOYMENT_NAME = 'che-operator'
export const CHE_OPERATOR_SELECTOR = 'app=che-operator'
export const DEFAULT_CHE_NAMESPACE = 'eclipse-che'
export const LEGACY_CHE_NAMESPACE = 'che'

// OLM common
export const DEFAULT_CHE_OLM_PACKAGE_NAME = 'eclipse-che'
export const DEFAULT_CHE_OPERATOR_SUBSCRIPTION_NAME = 'eclipse-che-subscription'
export const OPERATOR_GROUP_NAME = 'che-operator-group'
export const CSV_PREFIX = 'eclipse-che'
export const DEVWORKSPACE_CSV_PREFIX = 'devworkspace-operator'
// OLM channels
export const OLM_STABLE_CHANNEL_NAME = 'stable'
export const OLM_STABLE_CHANNEL_STARTING_CSV_TEMPLATE = 'eclipse-che.v{{VERSION}}'
export const OLM_NEXT_CHANNEL_NAME = 'next'
// OLM namespaces
export const DEFAULT_OPENSHIFT_MARKET_PLACE_NAMESPACE = 'openshift-marketplace'
export const DEFAULT_OLM_KUBERNETES_NAMESPACE = 'olm'
export const DEFAULT_OPENSHIFT_OPERATORS_NS_NAME = 'openshift-operators'
// OLM catalogs
export const CUSTOM_CATALOG_SOURCE_NAME = 'eclipse-che-custom-catalog-source'
export const NEXT_CATALOG_SOURCE_NAME = 'eclipse-che-preview'
export const NEXT_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR = 'custom-devworkspace-operator-catalog'
export const STABLE_CATALOG_SOURCE_DEV_WORKSPACE_OPERATOR = 'stable-custom-devworkspace-operator-catalog'
export const DEFAULT_OLM_SUGGESTED_NAMESPACE = 'eclipse-che'
export const KUBERNETES_OLM_CATALOG = 'operatorhubio-catalog'
export const OPENSHIFT_OLM_CATALOG = 'community-operators'

// Documentation links
export const DOC_LINK = 'https://www.eclipse.org/che/docs/'
export const DOC_LINK_RELEASE_NOTES = ''
export const DOCS_LINK_INSTALL_RUNNING_CHE_LOCALLY = 'https://www.eclipse.org/che/docs/che-7/installation-guide/installing-che-locally/'
export const DOCS_LINK_IMPORT_CA_CERT_INTO_BROWSER = 'https://www.eclipse.org/che/docs/che-7/end-user-guide/importing-certificates-to-browsers/'
export const DOCS_LINK_HOW_TO_ADD_IDENTITY_PROVIDER_OS4 = 'https://docs.openshift.com/container-platform/latest/authentication/understanding-identity-provider.html#identity-provider-overview_understanding-identity-provider'
export const DOCS_LINK_HOW_TO_CREATE_USER_OS3 = 'https://docs.openshift.com/container-platform/3.11/install_config/configuring_authentication.html'
export const DOC_LINK_CONFIGURE_API_SERVER = 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/#configuring-the-api-server'

export const OUTPUT_SEPARATOR = '-------------------------------------------------------------------------------'

// DevWorkspace
export const DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE = 'devworkspace-controller'

// HOOKS
export const DEFAULT_ANALYTIC_HOOK_NAME = 'analytics'

// Timeouts
export const DEFAULT_K8S_POD_WAIT_TIMEOUT = 600000
export const DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT = 60000

// Custom Resources names
export const CHE_CLUSTER_CRD = 'checlusters.org.eclipse.che'
export const CHE_CLUSTER_API_GROUP = 'org.eclipse.che'
export const CHE_CLUSTER_API_VERSION_V1 = 'v1'
export const CHE_CLUSTER_API_VERSION_V2 = 'v2'
export const CHE_CLUSTER_KIND_PLURAL = 'checlusters'

export const DEVFILE_WORKSPACE_API_GROUP = 'workspace.devfile.io'
export const DEVFILE_WORKSPACE_API_VERSION = 'v1alpha2'
export const DEVFILE_WORKSPACE_KIND_PLURAL = 'devworkspaces'

export const DEVFILE_WORKSPACE_ROUTINGS_API_GROUP = 'controller.devfile.io'
export const DEVFILE_WORKSPACE_ROUTINGS_VERSION = 'v1alpha1'
export const DEVFILE_WORKSPACE_ROUTINGS_KIND_PLURAL = 'devworkspaceroutings'
