/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'

export default class Stop extends Command {
  static description = 'stop Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'deployment-name': cheDeployment,
    'che-selector': string({
      description: 'Selector for Che Server resources',
      default: 'app=che,component=che',
      env: 'CHE_SELECTOR'
    }),
    'access-token': string({
      description: 'Che OIDC Access Token',
      env: 'CHE_ACCESS_TOKEN'
    }),
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper()
    const kh = new KubeHelper()
    const oc = new OpenShiftHelper()
    const tasks = new Listr([
      {
        title: 'Verify Kubernetes API',
        task: async (ctx: any, task: any) => {
          try {
            await kh.checkKubeApi()
            ctx.isOpenShift = await kh.isOpenShift()
            task.title = await `${task.title}...done`
            if (ctx.isOpenShift) {
              task.title = await `${task.title} (it's OpenShift)`
            }
          } catch (error) {
            this.error(`Failed to connect to Kubernetes API. ${error.message}`)
          }
        }
      },
      {
        title: `Verify if deployment \"${flags['deployment-name']}\" exist in namespace \"${flags.chenamespace}\"`,
        task: async (ctx: any, task: any) => {
          if (ctx.isOpenShift && await oc.deploymentConfigExist(flags['deployment-name'], flags.chenamespace)) {
            // minishift addon and the openshift templates use a deployment config
            ctx.deploymentConfigExist = true
            ctx.foundKeycloakDeployment = await oc.deploymentConfigExist('keycloak', flags.chenamespace)
            ctx.foundPostgresDeployment = await oc.deploymentConfigExist('postgres', flags.chenamespace)
            if (ctx.foundKeycloakDeployment && ctx.foundPostgresDeployment) {
              task.title = await `${task.title}...the dc "${flags['deployment-name']}" exists (as well as keycloak and postgres)`
            } else {
              task.title = await `${task.title}...the dc "${flags['deployment-name']}" exists`
            }
          } else if (await kh.deploymentExist(flags['deployment-name'], flags.chenamespace)) {
            // helm chart and Che operator use a deployment
            ctx.foundKeycloakDeployment = await kh.deploymentExist('keycloak', flags.chenamespace)
            ctx.foundPostgresDeployment = await kh.deploymentExist('postgres', flags.chenamespace)
            ctx.foundDevfileRegistryDeployment = await kh.deploymentExist('devfile-registry', flags.chenamespace)
            ctx.foundPluginRegistryDeployment = await kh.deploymentExist('plugin-registry', flags.chenamespace)
            if (ctx.foundKeycloakDeployment && ctx.foundPostgresDeployment) {
              task.title = await `${task.title}...it does (as well as keycloak and postgres)`
            } else {
              task.title = await `${task.title}...it does`
            }
          } else {
            this.error(`E_BAD_DEPLOY - Deployment and DeploymentConfig do not exist.\nNeither a Deployment nor a DeploymentConfig named "${flags['deployment-name']}" exist in namespace \"${flags.chenamespace}\", Che Server cannot be stopped.\nFix with: verify the namespace where Che is running (oc get projects)\nhttps://github.com/eclipse/che`, { code: 'E_BAD_DEPLOY' })
          }
        }
      },
      {
        title: `Verify if Che server pod is running (selector "${flags['che-selector']}")`,
        task: async (ctx: any, task: any) => {
          const cheServerPodExist = await kh.podsExistBySelector(flags['che-selector'] as string, flags.chenamespace)
          if (!cheServerPodExist) {
            task.title = `${task.title}...It doesn't.\nChe server was already stopped.`
            ctx.isAlreadyStopped = true
          } else {
            const cheServerPodReadyStatus = await kh.getPodReadyConditionStatus(flags['che-selector'] as string, flags.chenamespace)
            if (cheServerPodReadyStatus !== 'True') {
              task.title = `${task.title}...It doesn't.\nChe server is not ready yet. Try again in a few seconds.`
              ctx.isNotReadyYet = true
            } else {
              task.title = `${task.title}...done.`
            }
          }
        }
      },
      {
        title: 'Check Che server status',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet,
        task: async (ctx: any, task: any) => {
          let cheURL = ''
          try {
            cheURL = await che.cheURL(flags.chenamespace)
            const status = await che.getCheServerStatus(cheURL)
            ctx.isAuthEnabled = await che.isAuthenticationEnabled(cheURL)
            const auth = ctx.isAuthEnabled ? '(auth enabled)' : '(auth disabled)'
            task.title = await `${task.title}...${status} ${auth}`
          } catch (error) {
            this.error(`E_CHECK_CHE_STATUS_FAIL - Failed to check Che status (URL: ${cheURL}). ${error.message}`)
          }
        }
      },
      {
        title: 'Stop Che server and wait until it\'s ready to shutdown',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet,
        task: async (ctx: any, task: any) => {
          if (ctx.isAuthEnabled && !flags['access-token']) {
            this.error('E_AUTH_REQUIRED - Che authentication is enabled and an access token need to be provided (flag --access-token).\nFor instructions to retreive a valid access token refer to https://www.eclipse.org/che/docs/che-6/authentication.html')
          }
          try {
            const cheURL = await che.cheURL(flags.chenamespace)
            await che.startShutdown(cheURL, flags['access-token'])
            await che.waitUntilReadyToShutdown(cheURL)
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SHUTDOWN_CHE_SERVER_FAIL - Failed to shutdown Che server. ${error.message}`)
          }
        }
      },
      {
        title: `Scale \"${flags['deployment-name']}\" deployment to zero`,
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet,
        task: async (ctx: any, task: any) => {
          try {
            if (ctx.deploymentConfigExist) {
              await oc.scaleDeploymentConfig(flags['deployment-name'], flags.chenamespace, 0)
            } else {
              await kh.scaleDeployment(flags['deployment-name'], flags.chenamespace, 0)
            }
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale deployment. ${error.message}`)
          }
        }
      },
      {
        title: 'Wait until Che pod is deleted',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet,
        task: async (_ctx: any, task: any) => {
          await kh.waitUntilPodIsDeleted('app=che,component=che', flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Scale \"keycloak\" deployment to zero',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet && ctx.foundKeycloakDeployment,
        task: async (ctx: any, task: any) => {
          try {
            if (ctx.deploymentConfigExist) {
              await oc.scaleDeploymentConfig('keycloak', flags.chenamespace, 0)
            } else {
              await kh.scaleDeployment('keycloak', flags.chenamespace, 0)
            }
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale keycloak deployment. ${error.message}`)
          }
        }
      },
      {
        title: 'Wait until Keycloak pod is deleted',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet && ctx.foundKeycloakDeployment,
        task: async (_ctx: any, task: any) => {
          await kh.waitUntilPodIsDeleted('app=keycloak', flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Scale \"postgres\" deployment to zero',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet && ctx.foundPostgresDeployment,
        task: async (ctx: any, task: any) => {
          try {
            if (ctx.deploymentConfigExist) {
              await oc.scaleDeploymentConfig('postgres', flags.chenamespace, 0)
            } else {
              await kh.scaleDeployment('postgres', flags.chenamespace, 0)
            }
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale postgres deployment. ${error.message}`)
          }
        }
      },
      {
        title: 'Wait until Postgres pod is deleted',
        enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet && ctx.foundPostgresDeployment,
        task: async (_ctx: any, task: any) => {
          await kh.waitUntilPodIsDeleted('app=postgres', flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Scale \"devfile registry\" deployment to zero',
        enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
        task: async (ctx: any, task: any) => {
          try {
            if (ctx.deploymentConfigExist) {
              await oc.scaleDeploymentConfig('devfile-registry', flags.chenamespace, 0)
            } else {
              await kh.scaleDeployment('devfile-registry', flags.chenamespace, 0)
            }
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale devfile-registry deployment. ${error.message}`)
          }
        }
      },
      {
        title: 'Wait until Devfile registry pod is deleted',
        enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
        task: async (_ctx: any, task: any) => {
          await kh.waitUntilPodIsDeleted('app=che,component=devfile-registry', flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Scale \"plugin registry\" deployment to zero',
        enabled: (ctx: any) => ctx.foundPluginRegistryDeployment,
        task: async (ctx: any, task: any) => {
          try {
            if (ctx.deploymentConfigExist) {
              await oc.scaleDeploymentConfig('plugin-registry', flags.chenamespace, 0)
            } else {
              await kh.scaleDeployment('plugin-registry', flags.chenamespace, 0)
            }
            task.title = await `${task.title}...done`
          } catch (error) {
            this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale plugin-registry deployment. ${error.message}`)
          }
        }
      },
      {
        title: 'Wait until Plugin registry pod is deleted',
        enabled: (ctx: any) => ctx.foundPluginRegistryDeployment,
        task: async (_ctx: any, task: any) => {
          await kh.waitUntilPodIsDeleted('app=che,component=plugin-registry', flags.chenamespace)
          task.title = `${task.title}...done.`
        }
      },
    ], { renderer: flags['listr-renderer'] as any })

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:stop has completed.'
    })

    this.exit(0)
  }
}
