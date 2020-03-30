/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

declare module 'olm' {

  export interface OperatorSource {
    /**
    * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#resources
    */
    apiVersion: string;
    /**
    * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#types-kinds
    */
    kind: string;
    /**
    * Standard object's metadata.
    */
    metadata: V1ObjectMeta;

    spec: OperatorSourceSpec; 
  }

  export interface OperatorSourceSpec {
    endpoint: string;
    registryNamespace: string
    type: string;
  }

  export interface OperatorGroup {
    /**
    * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#resources
    */
    apiVersion: string;
    /**
    * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#types-kinds
    */
    kind: string;
    /**
    * Standard object's metadata.
    */
    metadata: V1ObjectMeta;

    spec: OperatorGroupSpec;
  }

  export interface OperatorGroupSpec {
    targetNamespaces: string[];
  }

  export interface Subscription {
    /**
    * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#resources
    */
    apiVersion: string;
    /**
    * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/api-conventions.md#types-kinds
    */
    kind: string;
    /**
    * Standard object's metadata.
    */
    metadata: V1ObjectMeta;

    spec: SubscriptionSpec
    status?: SubscriptionStatus
  }

  export interface SubscriptionSpec {
    channel: string
    installPlanApproval: string
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
    uuid?: string
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
}

