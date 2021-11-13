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
import { CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION } from '../constants'
import { KubeHelper } from './kube'
import { V1AwsS3ServerConfig, V1CheBackupServerConfiguration, V1CheClusterBackup, V1RestServerConfig, V1SftpServerConfing } from './types/backup-restore-crds'

export type BackupServerType = 'rest' | 'sftp' | 's3' | ''

export interface BackupServerConfig {
  /**
   * Type of backup server.
   * Can be obtained from url field.
   */
  type: BackupServerType
  /**
   * Full url to backup repository, including restic protocol,
   * e.g. rest://https://host.net:1234/repo
   */
  url: string
  /**
   * Backup repository password to encrypt / decrypt its content.
   */
  repoPassword: string
  /**
   * Data to login into backup server.
   */
  credentials?: BackupServersConfigsCredentials
}

export type BackupServersConfigsCredentials = RestBackupServerCredentials | SftpBackupServerCredentials | AwsS3BackupServerCredentials

export interface RestBackupServerCredentials {
  username: string
  password: string
}
export interface AwsS3BackupServerCredentials {
  awsAccessKeyId: string
  awsSecretAccessKey: string
}
export interface SftpBackupServerCredentials {
  sshKey: string
}

export const BACKUP_SERVER_CONFIG_NAME = 'eclipse-che-backup-server-config'

export const BACKUP_REPOSITORY_PASSWORD_SECRET_NAME = 'chectl-backup-repository-password'
export const REST_SERVER_CREDENTIALS_SECRET_NAME = 'chectl-backup-rest-server-credentials'
export const AWS_CREDENTIALS_SECRET_NAME = 'chectl-aws-credentials'
export const SSH_KEY_SECRET_NAME = 'chectl-backup-sftp-server-key'

/**
 * Detects backup server type. Returns empty if there is no type specified or type is invalid.
 * @param url full url to backup server including restic protocol, e.g. sftp://url
 */
export function getBackupServerType(url: string): BackupServerType {
  if (url.startsWith('rest:')) {
    return 'rest'
  } else if (url.startsWith('s3:')) {
    return 's3'
  } else if (url.startsWith('sftp:')) {
    return 'sftp'
  }
  return ''
}

/**
 * Submits backup of Che installation task.
 * @param namespace namespace in which Che is installed
 * @param name name of the backup CR to create
 * @param backupServerConfig backup server configuration data or name of the config CR
 */
export async function requestBackup(namespace: string, name: string, backupServerConfig?: BackupServerConfig | string): Promise<V1CheClusterBackup> {
  const kube = new KubeHelper()
  const backupServerConfigName = await getBackupServerConfigurationName(namespace, backupServerConfig)
  return kube.recreateBackupCr(namespace, name, backupServerConfigName)
}

/**
 * Submits Che restore task.
 * @param namespace namespace in which Che should be restored
 * @param name name of the restore CR to create
 * @param backupServerConfig backup server configuration data or name of the config CR
 */
export async function requestRestore(namespace: string, name: string, backupServerConfig?: BackupServerConfig | string, snapshotId?: string): Promise<V1CheClusterBackup> {
  const kube = new KubeHelper()
  const backupServerConfigName = await getBackupServerConfigurationName(namespace, backupServerConfig)
  if (!backupServerConfigName) {
    throw new Error(`No backup server configuration found in ${namespace} namespace`)
  }
  return kube.recreateRestoreCr(namespace, name, backupServerConfigName, snapshotId)
}

/**
 * Returns backup server configuration object name by backup server configuration data,
 * or checks that bacлup server configuration with given name exists.
 * This function may create a new backup server configuration or replace existing according to the given data.
 * Returns empty string if there is no data to create new one or choose from existing backup server configurations.
 * @param namespace namespace with backup server configuration
 * @param backupServerConfig backup server configuration data or name of the backup server config CR
 * @returns name of existing backup server configuration in the given namespace or empty string if none suitable
 */
export async function getBackupServerConfigurationName(namespace: string, backupServerConfig?: BackupServerConfig | string): Promise<string> {
  const kube = new KubeHelper()

  if (backupServerConfig) {
    if (typeof backupServerConfig === 'string') {
      // Name of CR with backup server configuration provided
      // Check if it exists
      const backupServerConfigCr = await kube.getCustomResource(namespace, backupServerConfig, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL)
      if (!backupServerConfigCr) {
        throw new Error(`Backup server configuration with '${backupServerConfig}' name not found in '${namespace}' namespace.`)
      }
      return backupServerConfig
    } else {
      // Backup server configuration provided
      const backupServerConfigCrYaml = parseBackupServerConfig(backupServerConfig)
      backupServerConfigCrYaml.metadata = new V1ObjectMeta()
      backupServerConfigCrYaml.metadata.namespace = namespace
      backupServerConfigCrYaml.metadata.name = BACKUP_SERVER_CONFIG_NAME
      await provisionCredentialsSecrets(namespace, backupServerConfig)
      await kube.recreateCheGroupCr(backupServerConfigCrYaml, CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL)
      return BACKUP_SERVER_CONFIG_NAME
    }
  }

  // No backup server configuration provided.
  // Read all existing backup server configurations within the namespace.
  const backupServerConfigs: V1CheBackupServerConfiguration[] = await kube.getAllCustomResources(CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL)
  switch (backupServerConfigs.length) {
  case 0:
    // There is no backup server configurations
    return ''
  case 1:
    // There is only one available backup server configuration, use it
    return backupServerConfigs[0].metadata!.name!
  default:
    // There are many backup server configurations available, use one created by chectl, if any
    const backupServerConfigCr = backupServerConfigs.find(cr => cr.metadata!.name === BACKUP_SERVER_CONFIG_NAME)
    if (!backupServerConfigCr) {
      throw new Error(`Too many backup servers configurations in '${namespace}'`)
    }
    return BACKUP_SERVER_CONFIG_NAME
  }
}

export function parseBackupServerConfig(backupServerConfig: BackupServerConfig): V1CheBackupServerConfiguration {
  const backupServerConfigCrYaml: V1CheBackupServerConfiguration = {
    apiVersion: `${CHE_CLUSTER_API_GROUP}/${CHE_CLUSTER_API_VERSION}`,
    kind: 'CheBackupServerConfiguration',
    spec: {},
  }
  const serverType = getBackupServerType(backupServerConfig.url)
  switch (serverType) {
  case 'rest':
    // Docs: https://restic.readthedocs.io/en/latest/030_preparing_a_new_repo.html#rest-server
    // Example urls: rest://host:5000/repo/ rest://https://user:password@host:5000/repo/
    const restRegex = /rest:(?:\/\/)?(?:(?<protocol>https?):\/\/)?(?:(?<credentials>.+)\@)?(?<hostname>[\w\.\-]+)(?::(?<port>\d{1,5}))?(?:\/(?<path>[\w\-\.\/]*))?/g
    const restUrlMatch = restRegex.exec(backupServerConfig.url)
    if (!restUrlMatch || !restUrlMatch.groups) {
      throw new Error(`Invalid REST server url: '${backupServerConfig.url}'`)
    }
    const restCfg: V1RestServerConfig = {
      hostname: restUrlMatch.groups.hostname,
      repositoryPath: restUrlMatch.groups.path,
      repositoryPasswordSecretRef: BACKUP_REPOSITORY_PASSWORD_SECRET_NAME,
      protocol: restUrlMatch.groups.protocol,
      port: parseInt(restUrlMatch.groups.port, 10),
    }
    if (restUrlMatch.groups.credentials) {
      const credentials = restUrlMatch.groups.credentials
      const colonIndex = credentials.indexOf(':')
      if (colonIndex === -1) {
        throw new Error(`Invalid REST server url: '${backupServerConfig.url}'`)
      }
      const username = credentials.substring(0, colonIndex)
      const password = credentials.substring(colonIndex + 1)
      backupServerConfig.credentials = { username, password }
    }
    if (backupServerConfig.credentials) {
      restCfg.credentialsSecretRef = REST_SERVER_CREDENTIALS_SECRET_NAME
    }
    backupServerConfigCrYaml.spec.rest = restCfg
    break
  case 's3':
    // Docs: https://restic.readthedocs.io/en/latest/030_preparing_a_new_repo.html#amazon-s3
    // Example urls: s3://s3.amazonaws.com/bucket/repo s3://http://server:port/bucket/repo
    const awsRegex = /^s3:(?:\/\/)?((?<protocol>https?):\/\/)?(?<hostname>[\w\.\-]+)?(?::(?<port>\d{1,5}))?\/(?<path>[\w\-\/]+)$/g
    const s3UrlMatch = awsRegex.exec(backupServerConfig.url)
    if (!s3UrlMatch || !s3UrlMatch.groups) {
      throw new Error(`Invalid S3 server url: '${backupServerConfig.url}'`)
    }
    const s3Cfg: V1AwsS3ServerConfig = {
      repositoryPath: s3UrlMatch.groups.path,
      repositoryPasswordSecretRef: BACKUP_REPOSITORY_PASSWORD_SECRET_NAME,
      awsAccessKeySecretRef: AWS_CREDENTIALS_SECRET_NAME,
      hostname: s3UrlMatch.groups.hostname,
      protocol: s3UrlMatch.groups.protocol,
      port: parseInt(s3UrlMatch.groups.port, 10),
    }
    backupServerConfigCrYaml.spec.awss3 = s3Cfg
    break
  case 'sftp':
    // Docs: https://restic.readthedocs.io/en/latest/030_preparing_a_new_repo.html#sftp
    // Example urls: sftp:user@host:/srv/repo sftp://user@host:1234//srv/repo
    const sftpRegex = /^sftp:(?:\/\/)?(?<username>\w+)\@(?<hostname>[\w\.\-]+):(?:(?<port>\d{1,5})\/)?(?<path>[\w\-\/]+)$/g
    const sftpUrlMatch = sftpRegex.exec(backupServerConfig.url)
    if (!sftpUrlMatch || !sftpUrlMatch.groups) {
      throw new Error(`Invalid SFTP server url: '${backupServerConfig.url}'`)
    }
    const sftpCfg: V1SftpServerConfing = {
      username: sftpUrlMatch.groups.username,
      hostname: sftpUrlMatch.groups.hostname,
      repositoryPath: sftpUrlMatch.groups.path,
      repositoryPasswordSecretRef: BACKUP_REPOSITORY_PASSWORD_SECRET_NAME,
      sshKeySecretRef: SSH_KEY_SECRET_NAME,
      port: parseInt(sftpUrlMatch.groups.port, 10),
    }
    backupServerConfigCrYaml.spec.sftp = sftpCfg
    break
  default:
    throw new Error(`Unknown backup server type: '${serverType}'`)
  }
  return backupServerConfigCrYaml
}

/**
 * Creates or replaces secrets in the target namespace with user provided credentials.
 * @param namespace namespace in which secrets should be created
 * @param backupServerConfig credentials provided by user
 */
async function provisionCredentialsSecrets(namespace: string, backupServerConfig: BackupServerConfig): Promise<void> {
  const kube = new KubeHelper()

  const data: { [key: string]: string } = { 'repo-password': backupServerConfig.repoPassword }
  await kube.createOrReplaceSecret(namespace, BACKUP_REPOSITORY_PASSWORD_SECRET_NAME, data)

  if (backupServerConfig.credentials) {
    const serverType = getBackupServerType(backupServerConfig.url)
    switch (serverType) {
    case 'rest':
      const restServerCredentials = backupServerConfig.credentials as RestBackupServerCredentials
      const username = restServerCredentials.username
      const password = restServerCredentials.password
      if (username && password) {
        const data = { username, password }
        await kube.createOrReplaceSecret(namespace, REST_SERVER_CREDENTIALS_SECRET_NAME, data)
      }
      break
    case 's3':
      const awsCredentials = backupServerConfig.credentials as AwsS3BackupServerCredentials
      const awsAccessKeyId = awsCredentials.awsAccessKeyId
      const awsSecretAccessKey = awsCredentials.awsSecretAccessKey
      if (awsAccessKeyId && awsSecretAccessKey) {
        const data = { awsAccessKeyId, awsSecretAccessKey }
        await kube.createOrReplaceSecret(namespace, AWS_CREDENTIALS_SECRET_NAME, data)
      }
      break
    case 'sftp':
      const sftpServerCredentials = backupServerConfig.credentials as SftpBackupServerCredentials
      if (sftpServerCredentials.sshKey) {
        const data = { 'ssh-privatekey': sftpServerCredentials.sshKey }
        await kube.createOrReplaceSecret(namespace, SSH_KEY_SECRET_NAME, data)
      }
      break
    default:
      throw new Error(`Unknown backup server type: '${serverType}'`)
    }
  }
}
