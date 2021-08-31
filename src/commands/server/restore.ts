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

import { CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL, CHE_CLUSTER_RESTORE_KIND_PLURAL, DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, OLM_STABLE_ALL_NAMESPACES_CHANNEL_NAME, OLM_STABLE_CHANNEL_NAME, OPERATOR_DEPLOYMENT_NAME, SUBSCRIPTION_NAME } from '../../constants'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { Subscription } from '../../api/typings/olm'
import { cheNamespace } from '../../common-flags'
import { requestRestore } from '../../api/backup-restore'
import { cli } from 'cli-ux'
import { ApiTasks } from '../../tasks/platforms/api'
import { OLMTasks } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { checkChectlAndCheVersionCompatibility, downloadTemplates } from '../../tasks/installers/common-tasks'
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
          let operatorDeploymentYaml = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (!operatorDeploymentYaml) {
            // There is no operator deployment in the namespace
            // Check if the operator in all namespaces mode
            operatorDeploymentYaml = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            if (!operatorDeploymentYaml) {
              // Still no operator deployment found
              ctx.currentOperatorVersion = ''
              task.title = `${task.title} operator is not deployed`
              return
            }
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
        title: 'Detecting operator installer...',
        // It is possible to skip '&& (flags.version || flags.rollback || flags['backup-cr'])' in the nabled condition below,
        // as ctx.currentOperatorVersion is set only if previous task, that has the condition, is executed.
        enabled: (ctx: any) => ctx.currentOperatorVersion && !flags['olm-channel'],
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          let operatorSubscriptionYaml: Subscription = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
          if (operatorSubscriptionYaml) {
            // OLM in all namespaces mode
            flags.installer = 'olm'
            flags['olm-channel'] = operatorSubscriptionYaml.spec.channel
            task.title = `${task.title}OLM`
            return
          }

          operatorSubscriptionYaml = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
          if (operatorSubscriptionYaml) {
            // OLM in single namespace mode
            flags.installer = 'olm'
            flags['olm-channel'] = operatorSubscriptionYaml.spec.channel
            task.title = `${task.title}OLM`
            return
          }

          // As ctx.currentOperatorVersion is set, the operator deployment exists
          flags.installer = 'operator'
          task.title = `${task.title}Operator`
        }
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
        title: 'Detecting additional parameters...',
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          ctx.isOpenshift = await kube.isOpenShift()

          // Set defaults for some parameters if they weren't set
          if (!flags.installer) {
            flags.installer = ctx.isOpenshift ? 'olm' : 'operator'
          }
          if (flags.installer === 'olm' && !flags['olm-channel']) {
            if (await kube.getOperatorSubscription(SUBSCRIPTION_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)) {
              flags['olm-channel'] = OLM_STABLE_ALL_NAMESPACES_CHANNEL_NAME
            } else {
              flags['olm-channel'] = OLM_STABLE_CHANNEL_NAME
            }
          }
          if (ctx.isOpenshift) {
            flags.platform = 'openshift'
            flags['cluster-monitoring'] = true
          } else {
            flags.platform = 'kubernetes'
          }

          task.title = `${task.title}OK`
        }
      },
      {
        title: 'Remove current Che operator',
        enabled: (ctx: any) => ctx.currentOperatorVersion && flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (ctx: any, _task: any) => {
          // All preparations and validations must be done before this task!

          // Delete old operator if any
          if (flags.installer === 'olm') {
            const olmTasks = new OLMTasks()
            const olmDeleteTasks = olmTasks.deleteTasks(flags)
            return new Listr(olmDeleteTasks, ctx.listrOptions)
          } else {
            // Operator
            const operatorTasks = new OperatorTasks()
            const operatorDeleteTasks = operatorTasks.deleteTasks(flags)
            return new Listr(operatorDeleteTasks, ctx.listrOptions)
          }
        }
      },
      {
        title: 'Deploy requested version of Che operator',
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (ctx: any, _task: any) => {
          // Use plain operator on Kubernetes or if it is requested instead of OLM
          if (!ctx.isOpenshift || flags.installer === 'operator') {
            const deployOperatorOnlyTasks = new Listr(undefined, ctx.listrOptions)
            deployOperatorOnlyTasks.add(checkChectlAndCheVersionCompatibility(flags))
            deployOperatorOnlyTasks.add(downloadTemplates(flags))

            const operatorTasks = new OperatorTasks()
            const operatorInstallTasks = await operatorTasks.deployTasks(flags, this)
            // Remove last tasks that deploys CR (it will be done on restore)
            operatorInstallTasks.splice(-2)
            deployOperatorOnlyTasks.add(operatorInstallTasks)

            return deployOperatorOnlyTasks
          } else {
            // OLM on Openshift
            const olmTasks = new OLMTasks()
            let olmInstallTasks = olmTasks.startTasks(flags, this)
            // Remove last tasks that deploys CR (it will be done on restore)
            olmInstallTasks.splice(-2)
            // Remove other redundant for restoring tasks
            const tasksToDelete = [
              'Create custom catalog source from file',
              'Set custom operator image',
            ]
            olmInstallTasks = olmInstallTasks.filter(task => tasksToDelete.indexOf(task.title) === -1)

            return new Listr(olmInstallTasks, ctx.listrOptions)
          }
        },
      },
      {
        title: 'Scheduling restore...',
        task: async (ctx: any, task: any) => {
          // At this point deployed operator should be of the version to restore to
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
}
