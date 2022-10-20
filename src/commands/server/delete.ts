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
import { boolean } from '@oclif/command/lib/flags'
import { cli } from 'cli-ux'
import * as Listrq from 'listr'
import { OLMDevWorkspaceTasks } from '../../tasks/components/devworkspace-olm-installer'
import { ChectlContext } from '../../api/context'
import { KubeHelper } from '../../api/kube'
import { assumeYes, batch, cheNamespace, CHE_TELEMETRY, listrRenderer, skipKubeHealthzCheck } from '../../common-flags'
import {
  DEFAULT_ANALYTIC_HOOK_NAME,
  DEFAULT_CHE_NAMESPACE, DSC_PROJECT_NAME, OPENSHIFT_OPERATORS_NAMESPACE, WORKSPACE_CONTROLLER_NAMESPACE,
} from '../../constants'
import { CheTasks } from '../../tasks/che'
import { DevWorkspaceTasks } from '../../tasks/components/devworkspace-operator-installer'
import { CheOLMInstaller } from '../../tasks/installers/olm/che-olm'
import { OperatorInstaller } from '../../tasks/installers/operator'
import { ApiTasks } from '../../tasks/platforms/api'
import {
  findWorkingNamespace,
  getCommandSuccessMessage,
  getProjectName,
  notifyCommandCompletedSuccessfully,
  wrapCommandError,
} from '../../util'
import Listr = require('listr')
import { DevSpacesOLMInstaller } from '../../tasks/installers/olm/ds-olm'
import { Installer } from '../../api/types/installer'

export default class Delete extends Command {
  static description = 'delete any Eclipse Che related resource'

  static flags: flags.Input<any> = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    batch,
    'delete-namespace': boolean({
      description: 'Indicates that a Eclipse Che namespace will be deleted as well',
      default: false,
    }),
    'delete-all': boolean({
      description: 'Indicates to delete Eclipse Che and Dev Workspace related resources',
      default: false,
    }),
    'listr-renderer': listrRenderer,
    'skip-deletion-check': boolean({
      description: 'Skip user confirmation on deletion check',
      default: false,
      hidden: true,
    }),
    'skip-kubernetes-health-check': skipKubeHealthzCheck,
    yes: assumeYes,
    telemetry: CHE_TELEMETRY,
  }

  async run() {
    const { flags } = this.parse(Delete)
    flags.chenamespace = flags.chenamespace || await findWorkingNamespace(flags) || DEFAULT_CHE_NAMESPACE

    const ctx = await ChectlContext.initAndGet(flags, this)
    await this.config.runHook(DEFAULT_ANALYTIC_HOOK_NAME, { command: Delete.id, flags })

    if (flags['skip-deletion-check']) {
      this.warn('\'--skip-deletion-check\' flag is deprecated, use \'--yes\' instead.')
      flags.yes = flags['skip-deletion-check']
    }

    const tasks = new Listrq([], ctx.listrOptions)

    const apiTasks = new ApiTasks()
    tasks.add(apiTasks.testApiTasks(flags))

    tasks.add({
      title: 'Uninstall Dev Workspace Operator',
      task: async (_ctx: any, _task: any) => {
        if (flags['delete-all']) {
          const tasks = new Listrq([], ctx.listrOptions)

          tasks.add({
            title: 'Delete operator resources',
            task: () => {
              const devWorkspaceTasks = new DevWorkspaceTasks(flags)
              if (ctx[ChectlContext.IS_OPENSHIFT]) {
                return new Listr(devWorkspaceTasks.getDeleteTasks(OPENSHIFT_OPERATORS_NAMESPACE))
              } else {
                return new Listr(devWorkspaceTasks.getDeleteTasks(WORKSPACE_CONTROLLER_NAMESPACE))
              }
            },
          })

          if (ctx[ChectlContext.IS_OPENSHIFT]) {
            tasks.add({
              title: 'Delete OLM resources',
              task: () => {
                const olmDevWorkspaceTasks = new OLMDevWorkspaceTasks(flags)
                return new Listr(olmDevWorkspaceTasks.getDeleteTasks())
              },
            })
          }
          return tasks
        }
      },
    })

    tasks.add({
      title: 'Uninstall Eclipse Che Operator',
      task: async (ctx: any, _task: any) => {
        const tasks = new Listrq([], ctx.listrOptions)
        tasks.add({
          title: 'Delete operator resources',
          task: () => {
            const operatorTasks = new OperatorInstaller(flags)
            return new Listr(operatorTasks.getDeleteTasks())
          },
        })

        if (ctx[ChectlContext.IS_OPENSHIFT]) {
          let olmInstaller: Installer
          if (getProjectName() === DSC_PROJECT_NAME) {
            olmInstaller = new DevSpacesOLMInstaller(flags)
          } else {
            olmInstaller = new CheOLMInstaller(flags)
          }
          tasks.add({
            title: 'Delete OLM resources',
            task: () => new Listr(olmInstaller.getDeleteTasks()),
          })
        }

        const cheTasks = new CheTasks(flags)
        tasks.add({
          title: 'Wait until all pods are deleted',
          task: () => new Listr(cheTasks.getWaitPodsDeletedTasks()),
        })
        if (flags['delete-namespace']) {
          tasks.add(cheTasks.getDeleteNamespaceTasks(flags))
        }

        return tasks
      },
    })

    if (flags.batch || await this.isDeletionConfirmed(flags)) {
      try {
        await tasks.run(ctx)
        cli.log(getCommandSuccessMessage())
      } catch (err: any) {
        this.error(wrapCommandError(err))
      }
    } else {
      this.exit(0)
    }

    if (!flags.batch) {
      notifyCommandCompletedSuccessfully()
    }
    this.exit(0)
  }

  async isDeletionConfirmed(flags: any): Promise<boolean> {
    const kc = new KubeHelper(flags)
    const cluster = kc.kubeConfig.getCurrentCluster()

    if (!cluster) {
      throw new Error('Failed to get current Kubernetes cluster. Check if the current context is set via kubectl/oc')
    }

    if (!flags.batch && !flags.yes) {
      return cli.confirm(`You're going to remove Eclipse Che server in namespace '${flags.chenamespace}' on server '${cluster ? cluster.server : ''}'. If you want to continue - press Y`)
    }

    return true
  }
}
