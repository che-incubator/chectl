/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export interface CheCluster {
    apiVersion?: string;
    kind?: string;
    metadata?: V1ObjectMeta;

    spec: CheClusterSpec
    status?: CheClusterStatus
}

export interface CheClusterSpec {
    server?: CheClusterSpecServer
    database?: CheClusterSpecDB
    auth?: CheClusterSpecAuth
    storage?: CheClusterSpecStorage
    metrics?: CheClusterSpecMetrics
    k8s?: CheClusterSpecK8SOnly
}

export interface CheClusterSpecServer {
    cheImage?: string
    cheImageTag?: string
    cheFlavor?: string
    cheDebug?: boolean

    devfileRegistryImage?: string
    pluginRegistryImage?: string
    pluginRegistryUrl?: string
    externalPluginRegistry?: boolean
    devfileRegistryUrl?: string
    externalDevfileRegistry?: boolean

    customCheProperties?: Map<string, string>
}

export interface CheClusterSpecDB {
    postgresImage?: string
}

export interface CheClusterSpecAuth {
    identityProviderImage?: string
    updateAdminPassword?: boolean
    oAuthClientName?: string
    identityProviderSecret: string
    identityProviderAdminUserName: string
    identityProviderPassword: string
    openShiftoAuth: boolean
}

export interface CheClusterSpecStorage {

}

export interface CheClusterSpecMetrics {

}

export interface CheClusterSpecK8SOnly {
    ingressDomain: string
}

export interface CheClusterStatus {
    cheVersion: string
}