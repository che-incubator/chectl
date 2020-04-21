/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { cli } from 'cli-ux'
import * as execa from 'execa'
import * as fs from 'fs'
import { copy, mkdirp, remove } from 'fs-extra'
import * as yaml from 'js-yaml'
import { ListrTask } from 'listr'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { CHE_CLUSTER_CR_NAME } from '../../constants'
import { isKubernetesPlatformFamily, isOpenshiftPlatformFamily } from '../../util'

export function createNamespaceTask(flags: any): ListrTask {
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

export function copyOperatorResources(flags: any, cacheDir: string): ListrTask {
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

export function createEclipeCheCluster(flags: any, kube: KubeHelper): ListrTask {
  return {
    title: `Create Eclipse Che cluster ${CHE_CLUSTER_CR_NAME} in namespace ${flags.chenamespace}`,
    task: async (ctx: any, task: any) => {
      const cheCluster = await kube.getCheCluster(CHE_CLUSTER_CR_NAME, flags.chenamespace)
      if (cheCluster) {
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

export function checkPreCreatedTls(flags: any, kube: KubeHelper): ListrTask {
  return {
    title: 'Checking for pre-created TLS secret',
    // In case of Openshift infrastructure the certificate from cluster router will be used, so no need in the `che-tls` secret.
    skip: () => !isKubernetesPlatformFamily(flags.platform),
    task: async (_: any, task: any) => {
      // Che is being deployed on Kubernetes infrastructure

      if (! await checkTlsMode(flags)) {
        // No TLS mode, skip this check
        return
      }

      const cheSecretName = 'che-tls'
      const cheSecret = await kube.getSecret(cheSecretName, flags.chenamespace)
      if (cheSecret) {
        task.title = `${task.title}... "${cheSecretName}" secret found`
        return
      }

      // The secret is required but doesn't exist, show error message.
      const errorMessage =
        `Che TLS mode is turned on, but required "${cheSecretName}" secret is not pre-created in "${flags.chenamespace}" namespace, so Eclipse Che cannot be started. \n` +
        'This is not bug in Eclipse Che and such behavior is expected. \n' +
        'Please refer to Che documentation for more informations: ' +
        'https://www.eclipse.org/che/docs/che-7/installing-che-in-tls-mode-with-self-signed-certificates/'
      throw new Error(errorMessage)
    }
  }
}

export function checkTlsSertificate(flags: any): ListrTask {
  return {
    title: 'Checking certificate',
    // If the flag is set no need to check if it is required
    skip: () => flags['self-signed-cert'],
    task: async (_: any, task: any) => {
      if (! await checkTlsMode(flags)) {
        // No TLS mode, skip this check
        return
      }

      const warningMessage = 'Self-signed certificate is used, so "--self-signed-cert" option is required. Added automatically.'

      const platform = flags.platform
      if (platform === 'minikube' || platform === 'crc' || platform === 'minishift') {
        // There is no way to use real certificate on listed above platforms
        cli.warn(warningMessage)
        flags['self-signed-cert'] = true
        task.title = `${task.title}... self-signed`
        return
      }

      if (flags.domain && (flags.domain.endsWith('nip.io') || flags.domain.endsWith('xip.io'))) {
        // It is not possible to use real certificate with *.nip.io and similar services
        cli.warn(warningMessage)
        flags['self-signed-cert'] = true
        task.title = `${task.title}... self-signed`
        return
      }

      // TODO check the secret certificate if it is commonly trusted.
      cli.info('TLS mode is turned on, however we failed to determine whether self-signed certificate is used. \n\
               Please rerun chectl with "--self-signed-cert" option if it is the case, otherwise Eclipse Che will fail to start.')
    }
  }
}

/**
 * Checks if TLS is disabled via operator custom resource.
 * Returns true if TLS is enabled (or omitted) and false if it is explicitly disabled.
 */
async function checkTlsMode(flags: any): Promise<boolean> {
  if (flags['che-operator-cr-yaml']) {
    const cheOperatorCrYamlPath = flags['che-operator-cr-yaml']
    if (fs.existsSync(cheOperatorCrYamlPath)) {
      const cr = yaml.safeLoad(fs.readFileSync(cheOperatorCrYamlPath).toString())
      if (cr && cr.spec && cr.spec.server && cr.spec.server.tlsSupport === false) {
        return false
      }
    }
  }

  if (flags['che-operator-cr-patch-yaml']) {
    const cheOperatorCrPatchYamlPath = flags['che-operator-cr-patch-yaml']
    if (fs.existsSync(cheOperatorCrPatchYamlPath)) {
      const crPatch = yaml.safeLoad(fs.readFileSync(cheOperatorCrPatchYamlPath).toString())
      if (crPatch && crPatch.spec && crPatch.spec.server && crPatch.spec.server.tlsSupport === false) {
        return false
      }
    }
  }

  // If tls flag is undefined we suppose that tls is turned on
  if (flags.tls === false) {
    return false
  }

  // TLS is on
  return true
}
