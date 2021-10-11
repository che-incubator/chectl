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

import { CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_CLUSTER_BACKUP_KIND_PLURAL, CHE_CLUSTER_RESTORE_KIND_PLURAL, DEFAULT_ANALYTIC_HOOK_NAME, DEFAULT_OPENSHIFT_OPERATORS_NS_NAME, OPERATOR_DEPLOYMENT_NAME } from '../../constants'
import { batch, CHE_TELEMETRY, listrRenderer } from '../../common-flags'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { CheHelper } from '../../api/che'
import { cheNamespace } from '../../common-flags'
import { getBackupServerConfigurationName, parseBackupServerConfig, requestRestore } from '../../api/backup-restore'
import { cli } from 'cli-ux'
import { ApiTasks } from '../../tasks/platforms/api'
import { TASK_TITLE_CREATE_CUSTOM_CATALOG_SOURCE_FROM_FILE, TASK_TITLE_DELETE_CUSTOM_CATALOG_SOURCE, TASK_TITLE_DELETE_NIGHTLY_CATALOG_SOURCE, OLMTasks, TASK_TITLE_SET_CUSTOM_OPERATOR_IMAGE, TASK_TITLE_PREPARE_CHE_CLUSTER_CR } from '../../tasks/installers/olm'
import { OperatorTasks } from '../../tasks/installers/operator'
import { checkChectlAndCheVersionCompatibility, downloadTemplates, TASK_TITLE_CREATE_CHE_CLUSTER_CRD, TASK_TITLE_PATCH_CHECLUSTER_CR } from '../../tasks/installers/common-tasks'
import { confirmYN, findWorkingNamespace, getCommandSuccessMessage, getEmbeddedTemplatesDirectory, notifyCommandCompletedSuccessfully, wrapCommandError } from '../../util'
import { V1CheBackupServerConfiguration, V1CheClusterBackup, V1CheClusterRestore, V1CheClusterRestoreStatus } from '../../api/types/backup-restore-crds'

import { awsAccessKeyId, awsSecretAccessKey, AWS_ACCESS_KEY_ID_KEY, AWS_SECRET_ACCESS_KEY_KEY, backupRepositoryPassword, backupRepositoryUrl, backupRestServerPassword, backupRestServerUsername, backupServerConfigName, BACKUP_REPOSITORY_PASSWORD_KEY, BACKUP_REPOSITORY_URL_KEY, BACKUP_REST_SERVER_PASSWORD_KEY, BACKUP_REST_SERVER_USERNAME_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY, getBackupServerConfiguration, sshKey, sshKeyFile, SSH_KEY_FILE_KEY, SSH_KEY_KEY } from './backup'

const RESTORE_CR_NAME = 'eclipse-che-restore'

export default class Restore extends Command {
  static description = 'Restore Eclipse Che installation'

  static examples = [
    '# Restore from the latest snapshot from a provided REST backup server:\n' +
    'chectl server:restore -r rest:http://my-sert-server.net:4000/che-backup -p repopassword --snapshot-id=latest',
    '# Restore from the latest snapshot from a provided AWS S3 (or API compatible) backup server (bucket must be precreated):\n' +
    'chectl server:restore -r s3:s3.amazonaws.com/bucketche -p repopassword --snapshot-id=latest',
    '# Restore from the latest snapshot from a provided SFTP backup server:\n' +
    'chectl server:restore -r sftp:user@my-server.net:/srv/sftp/che-data -p repopassword --snapshot-id=latest',
    '# Restore from a specific snapshot to a given Eclipse Che version from a provided REST backup server:\n' +
    'chectl server:restore -r rest:http://my-sert-server.net:4000/che-backup -p repopassword --version=7.35.2 --snapshot-id=9ea02f58',
    '# Rollback to a previous version only if backup exists:\n' +
    'chectl server:restore --rollback',
    '# Restore from a specific backup object:\n' +
    'chectl server:restore --backup-cr-name=backup-object-name',
  ]

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer,
    telemetry: CHE_TELEMETRY,
    batch,
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
      description:
        'snapshot identificator to restore from. ' +
        'Value "latest" means restoring from the most recent snapshot.',
      required: false,
    }),
    version: string({
      char: 'v',
      description:
        'Che Operator version to restore to (e.g. 7.35.1). ' +
        'If the flag is not set, restore to the current version.',
      required: false,
      dependsOn: ['snapshot-id'],
    }),
    'backup-cr-name': string({
      description: 'Name of a backup custom resource to restore from',
      required: false,
      exclusive: ['version', 'snapshot-id', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
    }),
    rollback: boolean({
      description: 'Rolling back to previous version of Eclipse Che only if backup exists',
      required: false,
      exclusive: ['version', 'snapshot-id', 'backup-cr-name', BACKUP_REPOSITORY_URL_KEY, BACKUP_SERVER_CONFIG_CR_NAME_KEY],
    }),
    installer: string({
      description: 'Installer type. Should be passed only if restoring without previous installation in place.',
      options: ['operator', 'olm'],
      hidden: true,
    }),
    'olm-channel': string({
      description:
        'Olm channel that was used when backup was done, e.g. "stable".' +
        'Should be passed only if restoring without previous installation in place and installer type is "olm".',
      hidden: true,
    }),
  }

  async run() {
    const { flags } = this.parse(Restore)
    const ctx = await ChectlContext.initAndGet(flags, this)
    flags.chenamespace = await findWorkingNamespace(flags)

    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Restore.id, flags })

    if (!flags['snapshot-id'] && !(flags.rollback || flags['backup-cr-name'])) {
      this.error('"--snapshot-id" flag is required')
    }

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
    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
  }

  private getRestoreTasks(flags: any): Listr.ListrTask[] {
    const kube = new KubeHelper(flags)
    const che = new CheHelper(flags)
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
            if (!flags.installer) {
              throw new Error('Cannot detect previous installer automatically, provide --installer flag')
            }

            if (flags.installer === 'olm') {
              if (!flags['olm-channel']) {
                throw new Error('Cannot detect OLM channel automatically, provide --olm-channel flag')
              }
              task.title = `${task.title}OLM`
            } else {
              task.title = `${task.title}Operator`
            }
            return
          }

          const subscription = await che.findCheOperatorSubscription(flags.chenamespace)
          if (subscription) {
            // OLM
            flags.installer = 'olm'
            flags['olm-channel'] = subscription.spec.channel
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
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version,
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
        title: 'Print restore information',
        task: async (ctx: any) => {
          const currentVersion = ctx.isOperatorDeployed ? ctx.currentOperatorVersion : 'Not deployed'
          const restoreVersion = flags.version ? flags.version : currentVersion
          const snapshotId = flags['snapshot-id'] ? flags['snapshot-id'] : 'latest'

          // Get backup server configuration
          let backupServer: string
          let backupRepository: string
          try {
            let backupServerConfigCr: V1CheBackupServerConfiguration
            if (ctx.backupServerConfig && typeof ctx.backupServerConfig !== 'string') {
              // ctx.backupServerConfig is BackupServerConfig
              backupServerConfigCr = parseBackupServerConfig(ctx.backupServerConfig)
            } else {
              // ctx.backupServerConfig is string | undefined
              const backupServerConfigName = ctx.backupServerConfig ? ctx.backupServerConfig : await getBackupServerConfigurationName(flags.chenamespace)
              backupServerConfigCr = await kube.getCustomResource(flags.chenamespace, backupServerConfigName, CHE_CLUSTER_API_GROUP, CHE_CLUSTER_API_VERSION, CHE_BACKUP_SERVER_CONFIG_KIND_PLURAL)
              if (!backupServerConfigCr) {
                throw new Error('No backup server config found, nothing to restore from')
              }
            }

            let hostname: string
            let port: number | undefined
            let repository: string
            if (backupServerConfigCr.spec.rest) {
              hostname = backupServerConfigCr.spec.rest.hostname
              port = backupServerConfigCr.spec.rest.port
              repository = backupServerConfigCr.spec.rest.repositoryPath
            } else if (backupServerConfigCr.spec.awss3) {
              hostname = backupServerConfigCr.spec.awss3.hostname || 's3.amazonaws.com'
              port = backupServerConfigCr.spec.awss3.port
              repository = backupServerConfigCr.spec.awss3.repositoryPath
            } else if (backupServerConfigCr.spec.sftp) {
              hostname = backupServerConfigCr.spec.sftp.hostname
              port = backupServerConfigCr.spec.sftp.port
              repository = backupServerConfigCr.spec.sftp.repositoryPath
            } else {
              throw new Error('Unknown backup server config type')
            }

            backupServer = hostname + (port ? `:${port}` : '')
            backupRepository = repository
          } catch (error) {
            const details = error.message ? `: ${error.message}` : ''
            backupServer = `Failed to get backup server info ${details}`
            backupRepository = 'Unknown'
          }

          const outputLines = [
            `Current version:   ${currentVersion}`,
            `Restore version:   ${restoreVersion}`,
            `Backup server:     ${backupServer}`,
            `Backup repository: ${backupRepository}`,
            `Snapshot:          ${snapshotId}`,
          ]

          // Print the information
          const printTasks = new Listr([], ctx.listrOptions)
          for (const line of outputLines) {
            printTasks.add({
              title: line,
              task: () => { },
            })
          }
          return printTasks
        },
      },
      {
        title: 'Asking for restore confirmation: Do you want to proceed? [y/n]',
        enabled: () => !flags.batch,
        task: async (_ctx: any, task: any) => {
          let isConfirmed: boolean
          try {
            isConfirmed = await confirmYN()
          } catch {
            isConfirmed = false
          }

          if (isConfirmed) {
            task.title = 'Asking for restore confirmation...OK'
          } else {
            task.title = 'Asking for restore confirmation...Cancelled'
            this.exit(0)
          }
        },
      },
      {
        title: 'Uninstall Eclipse Che operator',
        enabled: (ctx: any) => ctx.isOperatorDeployed && flags.version && ctx.currentOperatorVersion !== flags.version && flags.installer === 'olm',
        task: async (ctx: any, _task: any) => {
          // All preparations and validations must be done before this task!
          // Delete old operator if any in case of OLM installer.
          // For Operator installer, the operator deployment will be downgraded if needed.
          const olmTasks = new OLMTasks()
          let olmDeleteTasks = olmTasks.deleteTasks(flags)
          const tasksToDelete = [
            TASK_TITLE_DELETE_CUSTOM_CATALOG_SOURCE,
            TASK_TITLE_DELETE_NIGHTLY_CATALOG_SOURCE,
          ]
          olmDeleteTasks = olmDeleteTasks.filter(task => tasksToDelete.indexOf(task.title) === -1)
          return new Listr(olmDeleteTasks, ctx.listrOptions)
        },
      },
      {
        title: 'Deploy requested version of Che operator',
        // Deploy new operator only if there is a request for a different version given through flags.version
        enabled: (ctx: any) => flags.version && ctx.currentOperatorVersion !== flags.version,
        task: async (ctx: any, _task: any) => {
          const isOpenshift = await kube.isOpenShift()
          // Set defaults for some parameters if they weren't set
          if (isOpenshift) {
            flags.platform = 'openshift'
            flags['cluster-monitoring'] = true
          } else {
            flags.platform = 'k8s'
          }

          if (flags.installer === 'operator') {
            const operatorTasks = new OperatorTasks()
            // Update tasks can also deploy operator. If a resource already exist, it will be replaced.
            // When operator of requested version is deployed, then restore will rollout data from the backup.
            let operatorUpdateTasks = operatorTasks.updateTasks(flags, this)
            // Remove redundant for restoring tasks
            const tasksToDelete = [
              TASK_TITLE_PATCH_CHECLUSTER_CR,
            ]
            operatorUpdateTasks = operatorUpdateTasks.filter(task => tasksToDelete.indexOf(task.title) === -1)

            return new Listr(operatorUpdateTasks, ctx.listrOptions)
          } else { // OLM
            const olmTasks = new OLMTasks()
            let olmInstallTasks = olmTasks.startTasks(flags, this)
            // Remove redundant for restoring tasks
            const tasksToDelete = [
              // Remove customization and dev tasks
              TASK_TITLE_CREATE_CUSTOM_CATALOG_SOURCE_FROM_FILE,
              TASK_TITLE_SET_CUSTOM_OPERATOR_IMAGE,
              // Remove tasks that deploys CR (it will be done on restore)
              TASK_TITLE_PREPARE_CHE_CLUSTER_CR,
              TASK_TITLE_CREATE_CHE_CLUSTER_CRD,
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
