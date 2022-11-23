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

export namespace DevWorkspace {
  export const PRODUCT_NAME = 'Dev Workspace'
  // Webhook
  export const WEBHOOK = 'controller.devfile.io'

  // API
  export const WORKSPACE_API_GROUP = 'workspace.devfile.io'
  export const WORKSPACE_API_VERSION = 'v1alpha2'
  export const DEV_WORKSPACES_KIND = 'devworkspaces'
  export const DEV_WORKSPACES_CRD = 'devworkspaces.workspace.devfile.io'
  export const DEV_WORKSPACE_TEMPLATES_KIND = 'devworkspacetemplates'
  export const DEV_WORKSPACES_TEMPLATES_CRD = 'devworkspacetemplates.workspace.devfile.io'

  export const CONTROLLER_API_GROUP = 'controller.devfile.io'
  export const CONTROLLER_API_VERSION = 'v1alpha1'
  export const DEV_WORKSPACE_ROUTINGS_KIND = 'devworkspaceroutings'
  export const DEV_WORKSPACE_ROUTINGS_CRD = 'devworkspaceroutings.controller.devfile.io'
  export const DEV_WORKSPACE_OPERATOR_CONFIGS_PLURAL = 'devworkspaceoperatorconfigs'
  export const DEV_WORKSPACE_OPERATOR_CONFIGS_CRD = 'devworkspaceoperatorconfigs.controller.devfile.io'

  // Services
  export const WEBHOOK_SERVER_SERVICE = 'devworkspace-webhookserver'
  export const DEV_WORKSPACE_CONTROLLER_METRICS_SERVICE = 'devworkspace-controller-metrics'
  export const DEV_WORKSPACE_CONTROLLER_SERVICE = 'devworkspace-controller-manager-service'

  // Secrets
  export const WEBHOOK_SERVER_CERT = 'devworkspace-operator-webhook-cert'
  export const WEBHOOK_SERVER_TLS = 'devworkspace-webhookserver-tls'
  export const DEV_WORKSPACE_CONTROLLER_SERVICE_CERT = 'devworkspace-controller-manager-service-cert'

  // Deployments
  export const WEBHOOK_SERVER_DEPLOYMENT = 'devworkspace-webhook-server'
  export const DEV_WORKSPACE_CONTROLLER_DEPLOYMENT = 'devworkspace-controller-manager'

  // ServiceAccounts
  export const WEBHOOK_SERVER_SERVICE_ACCOUNT = 'devworkspace-webhook-server'
  export const DEV_WORKSPACE_CONTROLLER_SERVICE_ACCOUNT = 'devworkspace-controller-serviceaccount'

  // Roles
  export const DEV_WORKSPACE_LEADER_ELECTION_ROLE = 'devworkspace-controller-leader-election-role'
  export const DEV_WORKSPACE_SERVICE_CERT_ROLE = 'devworkspace-controller-manager-service-cert'

  // RoleBindings
  export const DEV_WORKSPACE_LEADER_ELECTION_ROLE_BINDING = 'devworkspace-controller-leader-election-rolebinding'
  export const DEV_WORKSPACE_SERVICE_CERT_ROLE_BINDING = 'devworkspace-controller-manager-service-cert'

  // ClusterRoles
  export const DEV_WORKSPACES_CLUSTER_ROLE = 'devworkspace-controller-role'
  export const DEV_WORKSPACE_EDIT_WORKSPACES_CLUSTER_ROLE = 'devworkspace-controller-edit-workspaces'
  export const DEV_WORKSPACES_VIEW_WORKSPACES_CLUSTER_ROLE = 'devworkspace-controller-view-workspaces'
  export const DEV_WORKSPACE_PROXY_CLUSTER_ROLE = 'devworkspace-controller-proxy-role'
  export const DEV_WORKSPACES_METRICS_CLUSTER_ROLE = 'devworkspace-controller-metrics-reader'
  export const DEV_WORKSPACES_WEBHOOK_CLUSTER_ROLE = 'devworkspace-webhook-server'

  // ClusterRoleBindings
  export const DEV_WORKSPACES_PROXY_CLUSTER_ROLE_BINDING = 'devworkspace-controller-proxy-rolebinding'
  export const DEV_WORKSPACES_CLUSTER_ROLE_BINDING = 'devworkspace-controller-rolebinding'
  export const DEV_WORKSPACES_WEBHOOK_CLUSTER_ROLE_BINDING = 'devworkspace-webhook-server'

  // Issuer
  export const DEV_WORKSPACE_CONTROLLER_CERTIFICATE = 'devworkspace-controller-serving-cert'
  export const DEV_WORKSPACE_CONTROLLER_ISSUER = 'devworkspace-controller-selfsigned-issuer'

  // Config
  export const DEV_WORKSPACE_OPERATOR_CONFIG = 'devworkspace-operator-config'

  // Olm
  export const KUBERNETES_NAMESPACE = 'devworkspace-controller'
  export const CATALOG_SOURCE = 'devworkspace-operator'
  export const CSV_PREFIX = 'devworkspace-operator'
  export const SUBSCRIPTION = 'devworkspace-operator'
  export const PACKAGE = 'devworkspace-operator'
  export const NEXT_CHANNEL = 'next'
  export const NEXT_CHANNEL_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:next'
  export const STABLE_CHANNEL = 'fast'
  export const STABLE_CHANNEL_CATALOG_SOURCE_IMAGE = 'quay.io/devfile/devworkspace-operator-index:release'
}
