/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { ListrTask, ListrContext} from 'listr'
import { CheHelper } from '../../api/che'
import * as execa from 'execa'
import { copy, mkdirp, remove } from 'fs-extra'
import * as path from 'path'
import { KubeHelper } from '../../api/kube'
import { operatorCheCluster } from '../../constants'
import { isOpenshiftPlatformFamily, isKubernetesPlatformFamily } from '../../util'

export function createNamespaceTask(flags: any): ListrTask<ListrContext> {
    return {
        title: `Create Namespace (${flags.chenamespace})`,
        task: async (_ctx: any, task: any) => {
            const che = new CheHelper(flags)  
            const exist = await che.cheNamespaceExist(flags.chenamespace)
            if (exist) {
                task.title = `${task.title}...It already exists.`
            } else if (isKubernetesPlatformFamily(flags.platform)) {
                await execa(`kubectl create namespace ${flags.chenamespace}`, { shell: true })
                task.title = `${task.title}...done.`
            } else if (isOpenshiftPlatformFamily(flags.platform)) {
                await execa(`oc new-project ${flags.chenamespace}`, { shell: true })
                task.title = `${task.title}...done.`
            }
        }
    }
}

export function copyOperatorResources(flags: any, cacheDir: string): ListrTask<ListrContext> {
    return {
        title: 'Copying operator resources',
        task: async (ctx: any, task: any) => {
          ctx.resourcesPath = await copyCheOperatorResources(flags.templates, cacheDir)
          task.title = `${task.title}...done.`
        }
    }
}

async function copyCheOperatorResources(templatesDir: string, cacheDir: string): Promise<string> {
    const srcDir = path.join(templatesDir, '/che-operator/')
    const destDir = path.join(cacheDir, '/templates/che-operator/')

    await remove(destDir)
    await mkdirp(destDir)
    await copy(srcDir, destDir)

    return destDir
}

export function createEclipeCheCluster(flags: any): ListrTask<ListrContext> {
    return {
        title: `Create Eclipse Che cluster ${operatorCheCluster} in namespace ${flags.chenamespace}`,
        task: async (ctx: any, task: any) => {
          const kube = new KubeHelper(flags)  
          const exist = await kube.cheClusterExist(operatorCheCluster, flags.chenamespace)
          if (exist) {
            task.title = `${task.title}...It already exists.`
          } else {
            // Eclipse Che operator supports only Multi-User Che
            ctx.isCheDeployed = true
            ctx.isPostgresDeployed = true
            ctx.isKeycloakDeployed = true

            // plugin and devfile registry will be deployed only when external ones are not configured
            ctx.isPluginRegistryDeployed = !(flags['plugin-registry-url'] as boolean)
            ctx.isDevfileRegistryDeployed = !(flags['devfile-registry-url'] as boolean)

            const yamlFilePath = flags['che-operator-cr-yaml'] === '' ? ctx.resourcesPath + 'crds/org_v1_che_cr.yaml' : flags['che-operator-cr-yaml']
            const cr = await kube.createCheClusterFromFile(yamlFilePath, flags, flags['che-operator-cr-yaml'] === '')
            ctx.isKeycloakReady = ctx.isKeycloakReady || cr.spec.auth.externalIdentityProvider
            ctx.isPostgresReady = ctx.isPostgresReady || cr.spec.database.externalDb
            ctx.isDevfileRegistryReady = ctx.isDevfileRegistryReady || cr.spec.server.externalDevfileRegistry
            ctx.isPluginRegistryReady = ctx.isPluginRegistryReady || cr.spec.server.externalPluginRegistry

            if (cr.spec.server.customCheProperties && cr.spec.server.customCheProperties.CHE_MULTIUSER === 'false') {
              flags.multiuser = false
            }

            task.title = `${task.title}...done.`
          }
        }
      }
}

