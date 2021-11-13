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

export interface V1CheClusterBackup {
  apiVersion: string
  kind: string
  metadata?: V1ObjectMeta
  spec: V1CheClusterBackupSpec
  status?: V1CheClusterBackupStatus
}

export interface V1CheClusterBackupSpec {
  useInternalBackupServer?: boolean
  backupServerConfigRef?: string
}

export interface V1CheClusterBackupStatus {
  message?: string
  state?: string
  stage?: string
  cheVersion?: string
  snapshotId?: string
}

export interface V1CheClusterRestore {
  apiVersion: string
  kind: string
  metadata?: V1ObjectMeta
  spec: V1CheClusterRestoreSpec
  status?: V1CheClusterRestoreStatus
}

export interface V1CheClusterRestoreSpec {
  snapshotId?: string
  backupServerConfigRef?: string
}

export interface V1CheClusterRestoreStatus {
  message?: string
  stage?: string
  state?: string
}

export interface V1CheBackupServerConfiguration {
  apiVersion: string
  kind: string
  metadata?: V1ObjectMeta
  spec: V1CheBackupServerConfigurationSpec
}

export interface V1CheBackupServerConfigurationSpec {
  rest?: V1RestServerConfig
  awss3?: V1AwsS3ServerConfig
  sftp?: V1SftpServerConfing
}

export interface V1RestServerConfig {
  protocol?: string
  hostname: string
  port?: number
  repositoryPath: string
  repositoryPasswordSecretRef: string
  credentialsSecretRef?: string
}

export interface V1AwsS3ServerConfig {
  protocol?: string
  hostname?: string
  port?: number
  repositoryPath: string
  repositoryPasswordSecretRef: string
  awsAccessKeySecretRef: string
}

export interface V1SftpServerConfing {
  username: string
  hostname: string
  port?: number
  repositoryPath: string
  repositoryPasswordSecretRef: string
  sshKeySecretRef: string
}
