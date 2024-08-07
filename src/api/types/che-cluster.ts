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

import { V1ObjectMeta } from '@kubernetes/client-node'

export interface CheCluster {
  kind: string
  metadata: V1ObjectMeta
  spec?: CheClusterSpec
  status?: CheClusterStatus
}

export interface CheClusterStatus {
  cheVersion?: string
  reason?: string
  message?: string
  chePhase?: string
}

interface CheClusterAuth {
  oAuthClientName?: string
}

interface CheClusterSpecNetworking {
  domain?: string
  tlsSecretName?: string
  auth?: CheClusterAuth
}

interface CheClusterContainerBuildConfiguration {
  openShiftSecurityContextConstraint?: string
}

interface CheClusterDevEnvironment {
  containerBuildConfiguration?: CheClusterContainerBuildConfiguration
}

export interface CheClusterSpec {
  components?: CheClusterComponents
  networking?: CheClusterSpecNetworking
  devEnvironments?: CheClusterDevEnvironment
}

interface CheClusterPluginRegistryComponent {
  disableInternalRegistry?: boolean
  openVSXURL?: string
}

export interface CheClusterComponents {
  pluginRegistry?: CheClusterPluginRegistryComponent
}
