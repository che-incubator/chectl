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

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as execa from 'execa'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { HelmHelper } from '../../installers/helm'
import { OperatorHelper } from '../../installers/operator'
import { MinikubeHelper } from '../../platforms/minikube'
export default class Start extends Command {
  static description = 'start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'kube-che',
      env: 'CHE_NAMESPACE'
    }),
    cheimage: string({
      char: 'i',
      description: 'Che server container image',
      default: 'eclipse/che-server:nightly',
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: path.join(__dirname, '../../../../chectl/templates'),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    }),
    debug: flags.boolean({
      char: 'd',
      description: 'Starts chectl in debug mode',
      default: false
    }),
    multiuser: flags.boolean({
      char: 'm',
      description: 'Starts che in multi-user mode',
      default: false
    }),
    tls: flags.boolean({
      char: 's',
      description: 'Enable TLS encryption and multi-user mode',
      default: false
    }),
    installer: string({
      char: 'a',
      description: 'Installer type. Valid values are \"helm\" and \"operator\"',
      default: 'helm'
    }),
    domain: string({
      char: 'b',
      description: 'Domain of the Kubernetes/OpenShift cluster (e.g. starter-us-east-2.openshiftapps.com or <local-ip>.nip.io)',
      default: ''
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"docker4mac\", \"ocp\", \"oso\".',
      default: 'minikube'
    })
  }

  async run() {
    const { flags } = this.parse(Start)
    const minikube = new MinikubeHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const operator = new OperatorHelper()
    const listr_renderer = (flags.debug) ? 'verbose' : 'default'
    let ingressName = 'che-ingress'

    // Platform Checks
    let platformCheckTasks = new Listr()
    if (flags.platform === 'minikube') {
      platformCheckTasks = new Listr([{
        title: 'Platform preflight checklist (minikube) ✈️',
        task: () => minikube.startTasks(this)
      }], {renderer: listr_renderer, collapse: false})
      if (!flags.domain) {
        const { stdout } = await execa.shell('minikube ip')
        flags.domain = stdout + '.nip.io'
      }
    } else {
      this.error(`Platform ${flags.installer} is not supported yet ¯\\_(ツ)_/¯`)
      this.exit()
    }

    // Installer
    let installerTasks = new Listr()
    if (flags.installer === 'helm') {
      installerTasks = new Listr([{
        title: 'Running the installer (Helm) 🏎️',
        task: () => helm.startTasks(flags, this)
      }], {renderer: listr_renderer, collapse: false})
    } else if (flags.installer === 'operator') {
      // The operator installs Che multiuser only
      flags.multiuser = true
      // The opertor and Helm use 2 distinct ingress names
      ingressName = 'che'
      installerTasks = new Listr([{
        title: 'Running the installer (Operator) 🏎️',
        task: () => operator.startTasks(flags, this)
      }], {renderer: listr_renderer, collapse: false})
    } else {
      this.error(`Installer ${flags.installer} is not supported ¯\\_(ツ)_/¯`)
      this.exit()
    }

    // Post Install Checks
    let cheBootstrapSubTasks = new Listr()
    const cheStartCheckTasks = new Listr([{
      title: 'Post installation checklist ✅',
      task: () => cheBootstrapSubTasks
    }], {
      renderer: listr_renderer,
      collapse: false
    })

    if (flags.multiuser) {
      cheBootstrapSubTasks.add({
        title: 'PostgreSQL pod bootstrap',
        task: () => this.podStartTasks('app=postgres', flags.chenamespace)
      })
      cheBootstrapSubTasks.add({
        title: 'Keycloak pod bootstrap',
        task: () => this.podStartTasks('app=keycloak', flags.chenamespace)
      })
    }

    cheBootstrapSubTasks.add({
      title: 'Che pod bootstrap',
      task: () => this.podStartTasks('app=che', flags.chenamespace)
    })

    cheBootstrapSubTasks.add({
      title: 'Retrieving Che Server URL',
      task: async (ctx: any, task: any) => {
        ctx.cheURL = await che.cheURLByIngress(ingressName, flags.chenamespace)
        task.title = await `${task.title}...${ctx.cheURL}`
      }
    })

    cheBootstrapSubTasks.add({
      title: 'Che status check',
      task: async ctx => che.isCheServerReady(ctx.cheURL, flags.chenamespace)
    })

    try {
      await platformCheckTasks.run()
      await installerTasks.run()
      await cheStartCheckTasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })
  }

  podStartTasks(selector: string, namespace: string | undefined = ''): Listr {
    const kube = new KubeHelper()
    return new Listr([
      {
        title: 'scheduling',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodPending(selector, namespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'downloading images',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodPhase(selector, 'Running', namespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'starting',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodReady(selector, namespace)
          task.title = `${task.title}...done.`
        }
      }
    ])
  }
}
