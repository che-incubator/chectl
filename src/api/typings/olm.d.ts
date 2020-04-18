/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export interface OperatorGroup {
  apiVersion: string;
  kind: string;
  metadata: V1ObjectMeta;

  spec: OperatorGroupSpec;
}

export interface OperatorGroupSpec {
  targetNamespaces: string[];
}

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
  conditions: InstallPlanCondition[]
}

export interface InstallPlanCondition {
  type: string
  status: string
}

export interface ClusterServiceVersion {
  kind: string;
  metadata: V1ObjectMeta;
}

export interface ClusterServiceVersionList {
  apiVersion: string
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
  address: string
  base64data: string
  mediatype: string
  sourceType: string
}

export interface PackageManifest {
  name: string
  status?: PackageManifestStatus
}

export interface PackageManifestStatus {
  catalogSource: string
  catalogSourceNamespace: string
}
