/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing
import { Command } from '@oclif/command'
import { cli } from 'cli-ux'
import * as execa from 'execa'
import { mkdirp } from 'fs-extra'
import * as Listr from 'listr'
import { ncp } from 'ncp'
import * as path from 'path'

import { CheHelper } from '../api/che'
import { KubeHelper } from '../api/kube'

export class OperatorHelper {
  operatorServiceAccount = 'che-operator'
  operatorRoleBinding = 'che-operator'
  operatorConfigMap = 'che-operator'
  operatorPod = 'che-operator'
  operatorImage = 'eclipse/che-operator'
  operatorRestartPolicy = 'Never'
  operatorImagePullPolicy = 'Always'

  startTasks(flags: any, command: Command): Listr {
    const che = new CheHelper()
    const kube = new KubeHelper(flags)
    return new Listr([
      {
        title: `Create Namespace (${flags.chenamespace})`,
        task: async (_ctx: any, task: any) => {
          const exist = await che.cheNamespaceExist(flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exist.`
          } else if (flags.platform === 'minikube') {
            await execa.shell(`kubectl create namespace ${flags.chenamespace}`)
            task.title = `${task.title}...done.`
          } else if (flags.platform === 'minishift') {
            await execa.shell(`oc new-project ${flags.chenamespace}`)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ServiceAccount ${this.operatorServiceAccount}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.serviceAccountExist(this.operatorServiceAccount, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exist.`
          } else if (flags.platform === 'minikube') {
            await execa.shell(`kubectl create serviceaccount ${this.operatorServiceAccount} -n=${flags.chenamespace}`)
            task.title = `${task.title}...done.`
          } else if (flags.platform === 'minishift') {
            await execa.shell(`oc create serviceaccount ${this.operatorServiceAccount} -n=${flags.chenamespace}`)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create RoleBinding ${this.operatorRoleBinding} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.roleBindingExist(this.operatorRoleBinding, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exist.`
          } else {
            await kube.createAdminRoleBinding(this.operatorRoleBinding, this.operatorServiceAccount, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Create ConfigMap ${this.operatorConfigMap} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.configMapExist(this.operatorConfigMap, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exist.`
          } else {
            const resourcesPath = await this.copyCheOperatorResources(flags.templates, command.config.cacheDir)
            await cli.wait(1000) //wait 1s to be sure that the file get flushed
            const yamlFilePath = resourcesPath + 'config.yaml'
            await kube.createConfigMapFromFile(yamlFilePath, flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        }
      },
      {
        title: `Patch ConfigMap ${this.operatorConfigMap} in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          const patch = { data: {
            CHE_INFRA_KUBERNETES_INGRESS_DOMAIN : flags.domain,
            CHE_OPENSHIFT_API_URL: '' }
          }
          await kube.patchConfigMap(this.operatorConfigMap, patch, flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Delete Pod ${this.operatorPod} in namespace ${flags.chenamespace} if it exist`,
        task: async (_ctx: any, task: any) => {
          const exist = await kube.podExist(this.operatorPod, flags.chenamespace)
          if (exist) {
            await kube.deletePod(this.operatorPod, flags.chenamespace)
            task.title = `${task.title}...done.`
          } else {
            task.title = `${task.title}...the Pod doesn't exist. Skipping.`
          }
        }
      },
      {
        title: 'Waiting 5 seconds for the new ServiceAccount and RoleBindings to be flushed',
        task: async (_ctx: any, task: any) => {
          await cli.wait(5000)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Create ${this.operatorPod} Pod in namespace ${flags.chenamespace}`,
        task: async (_ctx: any, task: any) => {
          await kube.createPod(this.operatorPod,
            this.operatorImage,
            this.operatorServiceAccount,
            this.operatorRestartPolicy,
            this.operatorImagePullPolicy,
            this.operatorConfigMap,
            flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
    ], {renderer: flags['listr-renderer'] as any})
  }

  async copyCheOperatorResources(templatesDir: string, cacheDir: string): Promise<string> {
    const srcDir = path.join(templatesDir, '/che-operator/')
    const destDir = path.join(cacheDir, '/templates/che-operator/')
    await mkdirp(destDir)
    await ncp(srcDir, destDir, {}, (err: Error) => { if (err) { throw err } })
    return destDir
  }
}
