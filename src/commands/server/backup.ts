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

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as fs from 'fs-extra'
import * as Listr from 'listr'

import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL, DEFAULT_ANALYTIC_HOOK_NAME } from '../../constants'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { batch, cheNamespace, CHE_TELEMETRY } from '../../common-flags'
import { requestBackup, BackupServerConfig, getBackupServerType } from '../../api/backup-restore'
import { V1CheClusterBackup, V1CheClusterBackupStatus } from '../../api/types/backup-restore-crds'
import { cli } from 'cli-ux'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'

export const BACKUP_REPOSITORY_URL_KEY = 'repository-url'
export const backupRepositoryUrl = string({
  char: 'r',
  description: 'Full address of backup repository. Format is identical to restic.',
  env: 'BACKUP_REPOSITORY_URL',
  required: false,
})

export const BACKUP_REPOSITORY_PASSWORD_KEY = 'repository-password'
export const backupRepositoryPassword = string({
  char: 'p',
  description: 'Password that is used to encrypt / decrypt backup repository content',
  env: 'BACKUP_REPOSITORY_PASSWORD',
  required: false,
})

export const BACKUP_REST_SERVER_USERNAME_KEY = 'username'
export const backupRestServerUsername = string({
  description: 'Username for authentication in backup REST server',
  env: 'REST_SERVER_USERNAME',
  required: false,
})

export const BACKUP_REST_SERVER_PASSWORD_KEY = 'password'
export const backupRestServerPassword = string({
  description: 'Authentication password for backup REST server',
  env: 'REST_SERVER_PASSWORD',
  required: false,
})

export const SSH_KEY_KEY = 'ssh-key'
export const sshKey = string({
  description: 'Private SSH key for authentication on SFTP server',
  env: 'SSH_KEY',
  required: false,
})

export const SSH_KEY_FILE_KEY = 'ssh-key-file'
export const sshKeyFile = string({
  description: 'Path to file with private SSH key for authentication on SFTP server',
  env: 'SSH_KEY_FILE',
  required: false,
  exclusive: [SSH_KEY_FILE_KEY],
})

export const AWS_ACCESS_KEY_ID_KEY = 'aws-access-key-id'
export const awsAccessKeyId = string({
  description: 'AWS access key ID',
  env: 'AWS_ACCESS_KEY_ID',
  required: false,
})

export const AWS_SECRET_ACCESS_KEY_KEY = 'aws-secret-access-key'
export const awsSecretAccessKey = string({
  description: 'AWS secret access key',
  env: 'AWS_SECRET_ACCESS_KEY',
  required: false,
})

export const BACKUP_SERVER_CONFIG_CR_NAME_KEY = 'backup-server-config-name'
export const backupServerConfigName = string({
  description: 'Name of custom resource with backup server config',
  env: 'BACKUP_SERVER_CONFIG_NAME',
  required: false,
  exclusive: [BACKUP_REPOSITORY_URL_KEY, BACKUP_REPOSITORY_PASSWORD_KEY],
})

const BACKUP_CR_NAME = 'eclipse-che-backup'

export default class Backup extends Command {
  static description = 'Backup Eclipse Che installation'

  static examples = [
    '# Reuse existing backup configuration or create and use internal backup server if none exists:\n' +
    'chectl server:backup',
    '# Create and use configuration for REST backup server:\n' +
    'chectl server:backup -r rest:http://my-sert-server.net:4000/che-backup -p repopassword',
    '# Create and use configuration for AWS S3 (and API compatible) backup server (bucket should be precreated):\n' +
    'chectl server:backup -r s3:s3.amazonaws.com/bucketche -p repopassword',
    '# Create and use configuration for SFTP backup server:\n' +
    'chectl server:backup -r sftp:user@my-server.net:/srv/sftp/che-data -p repopassword',
  ]

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    telemetry: CHE_TELEMETRY,
    batch,
    chenamespace: cheNamespace,
    [BACKUP_REPOSITORY_URL_KEY]: backupRepositoryUrl,
    [BACKUP_REPOSITORY_PASSWORD_KEY]: backupRepositoryPassword,
    [BACKUP_REST_SERVER_USERNAME_KEY]: backupRestServerUsername,
    [BACKUP_REST_SERVER_PASSWORD_KEY]: backupRestServerPassword,
    [SSH_KEY_KEY]: sshKey,
    [SSH_KEY_FILE_KEY]: sshKeyFile,
    [AWS_ACCESS_KEY_ID_KEY]: awsAccessKeyId,
    [AWS_SECRET_ACCESS_KEY_KEY]: awsSecretAccessKey,
    [BACKUP_SERVER_CONFIG_CR_NAME_KEY]: backupServerConfigName,
  }

  async run() {
    const { flags } = this.parse(Backup)
    const ctx = await ChectlContext.initAndGet(flags, this)
    flags.chenamespace = await findWorkingNamespace(flags)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Backup.id, flags })

    const tasks = new Listr([], ctx.listrOptions)
    const apiTasks = new ApiTasks()
    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add(this.getBackupTasks(flags))
    try {
      await tasks.run(ctx)
    } catch (err) {
      this.error(wrapCommandError(err))
    }

    if (ctx.snapshotId) {
      cli.info(`Backup snapshot ID: ${ctx.snapshotId}`)
    }
    cli.info(getCommandSuccessMessage())
    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
  }

  private getBackupTasks(flags: any): Listr.ListrTask[] {
    return [
      {
        title: 'Scheduling backup...',
        task: async (_ctx: any, task: any) => {
          const backupServerConfig = getBackupServerConfiguration(flags)
          await requestBackup(flags.chenamespace, BACKUP_CR_NAME, backupServerConfig)
          task.title = `${task.title}OK`
        },
      },
      {
        title: 'Waiting until backup process finishes...',
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          let backupStatus: V1CheClusterBackupStatus = {}
          do {
            await cli.wait(1000)
            const backupCr: V1CheClusterBackup = await kube.getCustomResource(flags.chenamespace, BACKUP_CR_NAME, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL)
            if (!backupCr.status) {
              continue
            }
            backupStatus = backupCr.status

            if (backupStatus.stage) {
              task.title = `Waiting until backup process finishes: ${backupStatus.stage}`
            }
          } while (!backupStatus.state || backupStatus.state === 'InProgress')

          if (backupStatus.state === 'Failed') {
            throw new Error(`Failed to create backup: ${backupStatus.message}`)
          }

          ctx.snapshotId = backupStatus.snapshotId
          task.title = 'Waiting until backup process finishes...OK'
        },
      },
    ]
  }
}

export function getBackupServerConfiguration(flags: { [name: string]: any }): BackupServerConfig | string | undefined {
  if (flags[BACKUP_SERVER_CONFIG_CR_NAME_KEY]) {
    // Backup server configuration CR name is provided
    return flags[BACKUP_SERVER_CONFIG_CR_NAME_KEY]
  }

  const repoUrl = flags[BACKUP_REPOSITORY_URL_KEY]
  const repoPassword = flags[BACKUP_REPOSITORY_PASSWORD_KEY]
  if (!repoUrl && !repoPassword) {
    // If there is no repo url and password, it is supposed that command do not have any backup server configured.
    // This could mean:
    // 1. Reuse last backup configuration, if any
    // 2. If no previous configuration, set up and use internal backup server
    return
  }

  // Ensure both repoUrl and repoPassword are set
  if (!repoUrl) {
    throw new Error(`Parameter ${BACKUP_REPOSITORY_URL_KEY} required`)
  }
  if (!repoPassword) {
    throw new Error(`Parameter ${BACKUP_REPOSITORY_PASSWORD_KEY} required`)
  }

  const serverType = getBackupServerType(repoUrl)
  const backupServerConfig: BackupServerConfig = {
    type: serverType,
    url: repoUrl,
    repoPassword,
  }

  switch (serverType) {
  case 'rest':
    const username = flags[BACKUP_REST_SERVER_USERNAME_KEY]
    const password = flags[BACKUP_REST_SERVER_PASSWORD_KEY]
    if (username && password) {
      backupServerConfig.credentials = { username, password }
    } else if (username || password) {
      // Only one parameter given, but this is not allowed
      if (username) {
        throw new Error(`${BACKUP_REST_SERVER_PASSWORD_KEY} parameter should be provided`)
      } else {
        throw new Error(`${BACKUP_REST_SERVER_USERNAME_KEY} parameter should be provided`)
      }
    }
    // If both username and password are empty, then authentication on the server is turned off

    warnAboutIgnoredCredentialsParameters(flags, [BACKUP_REST_SERVER_USERNAME_KEY, BACKUP_REST_SERVER_PASSWORD_KEY])
    break
  case 'sftp':
    if (!flags[SSH_KEY_KEY] && !flags[SSH_KEY_FILE_KEY]) {
      throw new Error(`SSH key should be provided via ${SSH_KEY_KEY} or ${SSH_KEY_FILE_KEY}`)
    } else if (flags[SSH_KEY_KEY] && flags[SSH_KEY_FILE_KEY]) {
      throw new Error(`Only one of ${SSH_KEY_KEY} and ${SSH_KEY_FILE_KEY} parameters should be provided`)
    }
    let sshKey: string
    if (flags[SSH_KEY_KEY]) {
      sshKey = flags[SSH_KEY_KEY]
    } else {
      // Read SSH key from file
      const sshKeyFilePath = flags[SSH_KEY_FILE_KEY]
      if (!fs.existsSync(sshKeyFilePath)) {
        throw new Error(`File ${sshKeyFilePath} with SSH key doesn't exist`)
      }
      sshKey = fs.readFileSync(sshKeyFilePath).toString().trim()
    }
    backupServerConfig.credentials = { sshKey }

    warnAboutIgnoredCredentialsParameters(flags, [SSH_KEY_KEY, SSH_KEY_FILE_KEY])
    break
  case 's3':
    if (!flags[AWS_ACCESS_KEY_ID_KEY]) {
      throw new Error(`${AWS_ACCESS_KEY_ID_KEY} should be provided`)
    }
    if (!flags[AWS_SECRET_ACCESS_KEY_KEY]) {
      throw new Error(`${AWS_SECRET_ACCESS_KEY_KEY} should be provided`)
    }
    backupServerConfig.credentials = {
      awsAccessKeyId: flags[AWS_ACCESS_KEY_ID_KEY],
      awsSecretAccessKey: flags[AWS_SECRET_ACCESS_KEY_KEY],
    }

    warnAboutIgnoredCredentialsParameters(flags, [AWS_ACCESS_KEY_ID_KEY, AWS_SECRET_ACCESS_KEY_KEY])
    break
  default:
    throw new Error(`Unrecognized backup server protocol in '${repoUrl}' url`)
  }

  return backupServerConfig
}

function warnAboutIgnoredCredentialsParameters(flags: { [name: string]: any }, requiredParameters: string[] = []): void {
  const credentialsParametersKeys = [
    BACKUP_REST_SERVER_USERNAME_KEY,
    BACKUP_REST_SERVER_PASSWORD_KEY,
    SSH_KEY_KEY,
    SSH_KEY_FILE_KEY,
    AWS_ACCESS_KEY_ID_KEY,
    AWS_SECRET_ACCESS_KEY_KEY,
  ]
  for (const key of credentialsParametersKeys) {
    if (flags[key] && !requiredParameters.includes(key)) {
      cli.warn(`${key} parameter is ignored`)
    }
  }
}
