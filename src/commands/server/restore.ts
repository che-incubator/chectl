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
import { cheNamespace } from '../../common-flags'
import { requestRestore } from '../../api/backup-restore'
import { cli } from 'cli-ux'
import { ApiTasks } from '../../tasks/platforms/api'
import { OLMTasks } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { checkChectlAndCheVersionCompatibility, downloadTemplates } from '../../tasks/installers/common-tasks'
import { findWorkingNamespace, getCommandSuccessMessage, getEmbeddedTemplatesDirectory, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'
import { V1CheClusterBackup, V1CheClusterRestore, V1CheClusterRestoreStatus } from '../../api/typings/backup-restore-crds'

import { awsAccessKeyId, awsSecretAccessKey, AWS_ACCESS_KEY_ID_KEY, AWS_SECRET_ACCESS_KEY_KEY, backupRepositoryPassword, backupRepositoryUrl, backupRestServerPassword, backupRestServerUsername, backupServerConfigName, BACKUP_REPOSITORY_PASSWORD_KEY, BACKUP_REPOSITORY_URL_KEY, BACKUP_REST_SERVER_PASSWORD_KEY, BACKUP_REST_SERVER_USERNAME_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY, getBackupServerConfiguration, sshKey, sshKeyFile, SSH_KEY_FILE_KEY, SSH_KEY_KEY } from './backup'
import { setDefaultInstaller } from './deploy'

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
    'chectl server:restore -r s3:s3.amazonaws.com/bucketche -p repopassword',
    '# Create and use configuration for SFTP backup server:\n' +
    'chectl server:restore -r=sftp:user@my-server.net:/srv/sftp/che-data -p repopassword',
    '# Rollback to previous version (if it was installed):\n' +
    'chectl server:restore --rollback',
    '# Restore from specific backup object:\n' +
    'chectl server:restore --backup-cr-name=backup-object-name',
    '# Restore from specific backup of different version:\n' +
    'chectl server:restore --version=7.35.2 --snapshot-id=9ea02f58 -r rest:http://my-sert-server.net:4000/che-backup -p repopassword',
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
      description:
        'Che Operator version to restore to (e.g. 7.35.1). ' +
        'Defaults to the existing operator version or to chectl version if none deployed.',
      required: false,
    }),
    'backup-cr-name': string({
      description: 'Name of a backup custom resource to restore from',
      required: false,
      exclusive: ['version', 'snapshot-id', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
    }),
    rollback: boolean({
      description: 'Rolling back to previous version of Eclipse Che if a backup of that version is available',
      required: false,
      exclusive: ['version', 'snapshot-id', 'backup-cr-name', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
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
    const kube = new KubeHelper(flags)
    return [
      {
        title: 'Detecting existing operator version...',
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)
          let operatorDeploymentYaml = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, flags.chenamespace)
          if (!operatorDeploymentYaml) {
            // There is no operator deployment in Che namespace
            // Check if the operator is in all namespaces mode
            operatorDeploymentYaml = await kube.getDeployment(OPERATOR_DEPLOYMENT_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            if (!operatorDeploymentYaml) {
              // Still no operator deployment found
              ctx.currentOperatorVersion = ''
              ctx.isOperatorDeployed = false
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
          ctx.isOperatorDeployed = true
          task.title = `${task.title} ${ctx.currentOperatorVersion} found`
        },
      },
      {
        title: 'Detecting installer...',
        task: async (ctx: any, task: any) => {
          if (!ctx.isOperatorDeployed) {
            setDefaultInstaller(flags)
            if (flags.installer === 'olm') {
              if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)) {
                flags['olm-channel'] = OLM_STABLE_ALL_NAMESPACES_CHANNEL_NAME
              } else {
                flags['olm-channel'] = OLM_STABLE_CHANNEL_NAME
              }
            }
            task.title = `${task.title}${flags.installer}`
            return
          }

          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)) {
            // OLM in all namespaces mode
            const operatorSubscriptionYaml = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME)
            flags.installer = 'olm'
            flags['olm-channel'] = operatorSubscriptionYaml.spec.channel
            task.title = `${task.title}OLM`
            return
          }

          if (await kube.operatorSubscriptionExists(SUBSCRIPTION_NAME, flags.chenamespace)) {
            // OLM in single namespace mode
            const operatorSubscriptionYaml = await kube.getOperatorSubscription(SUBSCRIPTION_NAME, flags.chenamespace)
            flags.installer = 'olm'
            flags['olm-channel'] = operatorSubscriptionYaml.spec.channel
            task.title = `${task.title}OLM`
            return
          }

          // As isOperatorDeployed is set, the operator deployment exists
          flags.installer = 'operator'
          task.title = `${task.title}Operator`
        },
      },
      {
        title: 'Looking for corresponding backup object...',
        enabled: () => flags.rollback,
        task: async (ctx: any, task: any) => {
          if (!ctx.isOperatorDeployed) {
            throw new Error('Che operator not found. Cannot detect version to use.')
          }
          const currentOperatorVersion: string = ctx.currentOperatorVersion
          const backupCrName = 'backup-before-update-to-' + currentOperatorVersion.replace(/\./g, '-')

          const kube = new KubeHelper(flags)
          const backupCr: V1CheClusterBackup = await kube.getCustomResource(flags.chenamespace, backupCrName, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL)
          if (!backupCr) {
            throw new Error(`Cannot find backup: ${backupCrName}`)
          }
          if (!backupCr.status || backupCr.status.state !== 'Succeeded') {
            throw new Error(`Backup with name '${backupCrName}' is not successful`)
          }
          flags['backup-cr-name'] = backupCrName
          task.title = `${task.title} ${backupCrName} found`
        },
      },
      {
        title: 'Gathering information about backup...',
        enabled: () => flags['backup-cr-name'],
        task: async (_ctx: any, task: any) => {
          const backupCrName = flags['backup-cr-name']
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
        },
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
        title: 'Getting installation templates...',
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version && !flags.templates,
        task: async (ctx: any, task: any) => {
          if (flags.installer === 'olm') {
            // Using embedded templates here as they are used in install flow for OLM.
            // OLM install flow should be reworked to not to use templates, but OLM dependencies.
            flags.templates = getEmbeddedTemplatesDirectory()
          } else {
            const getTemplatesTasks = new Listr(undefined, ctx.listrOptions)
            getTemplatesTasks.add(checkChectlAndCheVersionCompatibility(flags))
            getTemplatesTasks.add(downloadTemplates(flags))
            return getTemplatesTasks
          }
          task.title = `${task.title}OK`
        },
      },
      {
        title: 'Remove current Che operator',
        enabled: (ctx: any) => ctx.isOperatorDeployed && flags.installer === 'olm' && flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (ctx: any, _task: any) => {
          // All preparations and validations must be done before this task!
          // Delete old operator if any in case of OLM installer.
          // For Operator installer, the operator deployment will be downgraded if needed.
          const olmTasks = new OLMTasks()
          const olmDeleteTasks = olmTasks.deleteTasks(flags)
          return new Listr(olmDeleteTasks, ctx.listrOptions)
        },
      },
      {
        title: 'Deploy requested version of Che operator',
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (ctx: any, _task: any) => {
          const isOpenshift = await kube.isOpenShift()
          // Set defaults for some parameters if they weren't set
          if (isOpenshift) {
            flags.platform = 'openshift'
            flags['cluster-monitoring'] = true
          } else {
            flags.platform = 'kubernetes'
          }

          if (flags.installer === 'operator') {
            const operatorTasks = new OperatorTasks()
            // Update tasks can also deploy operator. If a resource already exist, it will be replaced.
            // When operator of requested version is deployed, then restore will rollout data from the backup.
            const operatorUpdateTasks = operatorTasks.updateTasks(flags, this)
            // Remove last tasks that deploys CR (it will be done on restore)
            operatorUpdateTasks.splice(-1)
            return new Listr(operatorUpdateTasks, ctx.listrOptions)
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
          } while (!restoreStatus.state || restoreStatus.state === 'InProgress')

          if (restoreStatus.state === 'Failed') {
            throw new Error(`Failed to restore installation: ${restoreStatus.message}`)
          }

          task.title = 'Waiting until restore process finishes...OK'
        },
      },
    ]
  }
}
