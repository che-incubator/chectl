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

import { V1Deployment, V1ObjectMeta } from '@kubernetes/client-node'

export interface Subscription {
  apiVersion: string;
  kind: string;
  metadata: V1ObjectMeta;

  spec: SubscriptionSpec
  status?: SubscriptionStatus
}

export interface SubscriptionSpec {
  channel?: string
  installPlanApproval?: string
  name: string
  source: string
  sourceNamespace: string
  startingCSV?: string
}

export interface SubscriptionStatus {
  conditions: SubscriptionStatusCondition[]
  currentCSV: string
  installedCSV?: string
  installplan: InstallPlan
  state: string
}

export interface SubscriptionStatusCondition {
  message: string
  reason: string
  status: string
  type: string
}

export interface InstallPlan {
  apiVersion?: string
  kind?: string
  name?: string
  namespace?: string
  spec?: InstallPlanSpec
  status?: InstallPlanStatus
}

export interface InstallPlanSpec {
  approved?: boolean
}

export interface InstallPlanStatus {
  phase?: string
  conditions: InstallPlanCondition[]
}

export interface InstallPlanCondition {
  type: string
  status: string
  reason: string
  message: string
}

export interface ClusterServiceVersion {
  apiVersion: string
  kind: string
  metadata: V1ObjectMeta
  spec: ClusterServiceVersionSpec
  status: ClusterServiceVersionStatus
}

export interface ClusterServiceVersionSpec {
  displayName: string
  install: OperatorInstall
  version: string
}

export interface ClusterServiceVersionStatus {
  phase: string
  message: string
  reason: string
}

export interface OperatorInstall {
  strategy: string
  spec: OperatorInstallSpec
}

export interface OperatorInstallSpec {
  clusterPermissions: any
  deployments: Array<V1Deployment>
  permissions: any
}

export interface ClusterServiceVersionList {
  apiVersion: string
  metadata: V1ObjectMeta
  kind: string
  items: Array<ClusterServiceVersion>
}

export interface CatalogSource {
  apiVersion: string
  kind: string
  metadata: V1ObjectMeta
  spec: CatalogSourceSpec
}

export interface CatalogSourceSpec {
  address?: string
  base64data?: string
  mediatype?: string
  sourceType: string
  image: string
  updateStrategy?: CatalogSourceUpdateStrategy
}

export interface CatalogSourceUpdateStrategy {
  registryPoll: CatalogSourceRegistryPoll
}

export interface CatalogSourceRegistryPoll {
  interval: string
}

export interface PackageManifest {
  name: string
  status?: PackageManifestStatus
}

export interface PackageManifestStatus {
  catalogSource: string
  catalogSourceNamespace: string
}
