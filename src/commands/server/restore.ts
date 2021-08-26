/**
 * Copyright (c) 2021 Red Hat, Inc.
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
import { boolean, string } from '@oclif/parser/lib/flags'
import * as Listr from 'listr'

import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL, CHE_CLUSTER_RESTORE_KIND_PLURAL, DEFAULT_ANALYTIC_HOOK_NAME, OPERATOR_DEPLOYMENT_NAME } from '../../constants'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { cheNamespace } from '../../common-flags'
import { requestRestore } from '../../api/backup-restore'
import { cli } from 'cli-ux'
import { ApiTasks } from '../../tasks/platforms/api'
import { findWorkingNamespace, getCommandSuccessMessage, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'
import { V1CheClusterBackup, V1CheClusterRestore, V1CheClusterRestoreStatus } from '../../api/typings/backup-restore-crds'

import { awsAccessKeyId, awsSecretAccessKey, AWS_ACCESS_KEY_ID_KEY, AWS_SECRET_ACCESS_KEY_KEY, backupRepositoryPassword, backupRepositoryUrl, backupRestServerPassword, backupRestServerUsername, backupServerConfigName, BACKUP_REPOSITORY_PASSWORD_KEY, BACKUP_REPOSITORY_URL_KEY, BACKUP_REST_SERVER_PASSWORD_KEY, BACKUP_REST_SERVER_USERNAME_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY, getBackupServerConfiguration, sshKey, sshKeyFile, SSH_KEY_FILE_KEY, SSH_KEY_KEY } from './backup'

const RESTORE_CR_NAME = 'eclipse-che-restore'

export default class Restore extends Command {
  static description = 'Restore Eclipse Che installation'

  static examples = [
    '# Reuse existing backup configuration:\n' +
    'chectl server:restore',
    '# Restore from specific backup snapshot using previos backup configuration:\n' +
    'chectl server:restore -s 585421f3',
    '# Create and use configuration for REST backup server:\n' +
    'chectl server:resotre -r rest:http://my-sert-server.net:4000/che-backup -p repopassword',
    '# Create and use configuration for AWS S3 (and API compatible) backup server (bucket should be precreated):\n' +
    'chectl server:backup -r s3:s3.amazonaws.com/bucketche -p repopassword',
    '# Create and use configuration for SFTP backup server:\n' +
    'chectl server:backup -r=sftp:user@my-server.net:/srv/sftp/che-data -p repopassword',
  ]

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
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
    'snapshot-id': string({
      char: 's',
      description: 'ID of a snapshot to restore from',
      required: false,
    }),
    version: string({
      char: 'v',
      description: `
        Che Operator version to restore to (e.g. 7.35.1).
        Must comply with the version in backup snapshot.
        Defaults to the existing operator version or to chectl version if none deployed.
      `,
      required: false,
    }),
    'backup-cr': string({
      description: 'Name of a backup custom resource to restore from',
      required: false,
      exclusive: ['version', 'snapshot-id', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
    }),
    'rollback': boolean({
      description: 'Rolling back to previous version of Eclipse Che if a backup of that version is available',
      required: false,
      exclusive: ['version', 'snapshot-id', 'backup-cr', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
    }),
  }

  async run() {
    const { flags } = this.parse(Restore)
    const ctx = await ChectlContext.initAndGet(flags, this)
    flags.chenamespace = await findWorkingNamespace(flags)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Restore.id, flags })

    const tasks = new Listr([], ctx.listrOptions)
    const apiTasks = new ApiTasks()
    tasks.add(apiTasks.testApiTasks(flags))
    tasks.add(this.getRestoreTasks(flags))
    try {
      await tasks.run(ctx)
    } catch (err) {
      this.error(wrapCommandError(err))
    }

    cli.info(getCommandSuccessMessage())
    notifyCommandCompletedSuccessfully()
  }

  private getRestoreTasks(flags: any): Listr.ListrTask[] {
    return [
      {
        title: 'Detecting existing operator version...',
        enabled: flags.version || flags.rollback || flags['backup-cr'],
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          const operatorDeploymentYaml = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (!operatorDeploymentYaml) {
            // There is no operator deployment
            ctx.currentOperatorVersion = ''
            task.title = `${task.title} operator is not deployed`
            return
          }
          const operatorEnv = operatorDeploymentYaml.spec!.template.spec!.containers[0].env!
          const currentVersionEnvVar = operatorEnv.find(envVar => envVar.name === 'CHE_VERSION')
          if (!currentVersionEnvVar) {
            throw new Error(`Failed to find Che operator version in '${OPERATOR_DEPLOYMENT_NAME}' deployment in '${flags.chenamespace}' namespace`)
          }
          ctx.currentOperatorVersion = currentVersionEnvVar.value
          task.title = `${task.title} ${ctx.currentOperatorVersion} found`
        },
      },
      {
        title: 'Looking for corresponding backup object...',
        enabled: flags.rollback,
        task: async (ctx: any, task: any) => {
          const currentOperatorVersion: string | undefined = ctx.currentOperatorVersion
          if (!currentOperatorVersion) {
            throw new Error('Che operator not found. Cannot detect version to use.')
          }
          const backupCrName = "backup-before-update-to-" + currentOperatorVersion.replace(/./g, '-')

          const kube = new KubeHelper(flags)
          const backupCr = await kube.getCustomResource(flags.chenamespace, backupCrName, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL)
          if (!backupCr) {
            throw new Error(`Cannot find backup: ${backupCrName}`)
          }
          flags['backup-cr'] = backupCrName
          task.title = `${task.title} ${backupCrName} found`
        }
      },
      {
        title: 'Gathering information about backup...',
        enabled: flags['backup-cr'],
        task: async (ctx: any, task: any) => {
          const backupCrName = flags['backup-cr']
          const kube = new KubeHelper(flags)
          const backupCr: V1CheClusterBackup | undefined = await kube.getCustomResource(flags.chenamespace, backupCrName, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL)
          if (!backupCr) {
            throw new Error(`Backup CR with name '${backupCrName}' not found`)
          }

          if (!backupCr.spec.backupServerConfigRef) {
            throw new Error(`Backup CR '${backupCrName}' missing backup server configuration reference`)
          }
          if (!backupCr.status || !backupCr.status.cheVersion) {
            throw new Error(`Backup CR '${backupCrName}' missing Che version`)
          }
          if (!backupCr.status || !backupCr.status.snapshotId) {
            throw new Error(`Backup CR '${backupCrName}' missing snapshot ID`)
          }

          flags.version = backupCr.status.cheVersion
          flags['snapshot-id'] = backupCr.status.snapshotId
          task.title = `${task.title}OK`
        }
      },
      {
        title: 'Getting backup server info...',
        task: async (ctx: any, task: any) => {
          // Get all information about backup server and validate it where possible
          // before redeploying operator to requested version.
          ctx.backupServerConfig = getBackupServerConfiguration(flags)
          task.title = `${task.title}OK`
        },
      },
      {
        title: 'Deploy Che operator of requested version',
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (_ctx: any, _task: any) => {
          // All preparations and validations must be done before this task
          return this.getRedeployOperatorTasks(flags)
        },
      },
      {
        title: 'Scheduling restore...',
        task: async (ctx: any, task: any) => {
          await requestRestore(flags.chenamespace, RESTORE_CR_NAME, ctx.backupServerConfig, flags['snapshot-id'])
          task.title = `${task.title}OK`
        },
      },
      {
        title: 'Waiting until restore process finishes...',
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          let restoreStatus: V1CheClusterRestoreStatus = {}
          do {
            await cli.wait(1000)
            const restoreCr: V1CheClusterRestore = await kube.getCustomResource(flags.chenamespace, RESTORE_CR_NAME, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_RESTORE_KIND_PLURAL)
            if (!restoreCr.status) {
              continue
            }
            restoreStatus = restoreCr.status

            if (restoreStatus.stage) {
              task.title = `Waiting until restore process finishes: ${restoreStatus.stage}`
            }
          } while (restoreStatus.state === 'InProgress')

          if (restoreStatus.state === 'Failed') {
            throw new Error(`Failed to restore installation: ${restoreStatus.message}`)
          }

          task.title = 'Waiting until restore process finishes...OK'
        },
      },
    ]
  }

  /**
   * Returns list of tasks that (re)deploys the flags.version version of Che operator.
   */
  private getRedeployOperatorTasks(flags: any): ReadonlyArray<Listr.ListrTask> {
    return [
      {
        title: '',
        task: async (ctx: any, task: any) => {

        }
      },
    ]
  }

}
