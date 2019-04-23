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

import { V1Deployment, V1DeploymentSpec, V1ObjectMeta, V1PodTemplateSpec, V1Service, V1ServicePort, V1ServiceSpec, V1beta1Ingress, V1beta1IngressSpec, V1PersistentVolumeClaim, V1PersistentVolumeClaimSpec } from '@kubernetes/client-node'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as yaml from 'js-yaml'

import { Devfile, DevfileComponent, TheEndpointName } from '../../api/devfile'
import { KubeHelper } from '../../api/kube'

const kube = new KubeHelper()
const stringLitArray = <L extends string>(arr: L[]) => arr
const languages = stringLitArray(['java', 'typescript', 'go', 'python', 'c#'])
export type Language = (typeof languages)[number]

const LanguagesComponents = new Map<Language, DevfileComponent>([
  ['java', {type: TheEndpointName.ChePlugin, alias: 'java-ls', id: 'org.eclipse.che.vscode-redhat.java:0.38.0'}],
  ['typescript', {type: TheEndpointName.ChePlugin, alias: 'typescript-ls', id: 'ms-vscode.typescript:1.30.2'}],
  ['go', {type: TheEndpointName.ChePlugin, alias: 'go-ls', id: 'ms-vscode.go:0.9.2'}],
  ['python', {type: TheEndpointName.ChePlugin, alias: 'python-ls', id: 'ms-python.python:2019.2.5433'}],
  ['c#', {type: TheEndpointName.ChePlugin, alias: 'csharp-ls', id: 'che-omnisharp-plugin:0.0.1'}],
])

export default class Generate extends Command {
  static description = 'generate and print a devfile to stdout given some Kubernetes resources and other Che workspaces features (project, language-support, commands etc...)'

  static flags = {
    help: flags.help({ char: 'h' }),
    namespace: string({
      description: 'Kubernetes namespace where the resources are defined',
      default: '',
      env: 'NAMESPACE',
      required: false,
    }),
    selector: string({
      description: 'label selector to filter the Kubernetes resources',
      env: 'SELECTOR',
      required: false,
    }),
    language: string({
      description: `add support for a particular language. Currently supported languages: ${languages}`,
      env: 'LANGUAGE_SUPPORT',
      required: false,
    }),
    plugin: string({
      description: 'Che plugin to include in the workspace',
      env: 'CHE_PLUGIN',
      required: false,
    }),
    project: string({
      description: 'source code project to include in the workspace',
      env: 'PROJECT',
      required: false,
    }),
    command: string({
      description: 'command to include in the workspace',
      env: 'COMMAND',
      required: false,
    }),
  }

  async run() {
    const { flags } = this.parse(Generate)
    const notifier = require('node-notifier')
    let devfile: Devfile = {
      specVersion: '0.0.1',
      name: 'chectl-generated'
    }

    if (flags.selector !== undefined) {
      let k8sList = {
        kind: 'List',
        apiVersion: 'v1',
        metadata: {
          name: `${flags.selector}`
        },
        items: new Array<any>()
      }

      const deployments = await this.getDeploymentsBySelector(flags.selector, flags.namespace)
      const services = await this.getServicesBySelector(flags.selector, flags.namespace)
      const ingresses = await this.getIngressesBySelector(flags.selector, flags.namespace)
      const pvcs = await this.getPersistentVolumeClaimsBySelector(flags.selector, flags.namespace)

      deployments.forEach((element: any) => {
        k8sList.items.push(element)
      })
      services.forEach((element: any) => {
        k8sList.items.push(element)
      })
      ingresses.forEach((element: any) => {
        k8sList.items.push(element)
      })
      pvcs.forEach((element: any) => {
        k8sList.items.push(element)
      })

      const component: DevfileComponent = {
        type: TheEndpointName.Kubernetes,
        alias: `${flags.selector}`,
        referenceContent: `${yaml.safeDump(k8sList)}`
      }
      if (devfile.components) {
        devfile.components.push(component)
      } else {
        devfile.components = [component]
      }
    }

    if (flags.project !== undefined) {
      if (devfile.projects) {
        devfile.projects.push(JSON.parse(flags.project))
      } else {
        devfile.projects = [JSON.parse(flags.project)]
      }
    }

    if (flags.plugin !== undefined) {
      if (devfile.components) {
        devfile.components.push(JSON.parse(flags.plugin))
      } else {
        devfile.components = [JSON.parse(flags.plugin)]
      }
    }

    if (flags.command !== undefined) {
      if (devfile.commands) {
        devfile.commands.push(JSON.parse(flags.command))
      } else {
        devfile.commands = [JSON.parse(flags.command)]
      }
    }

    if (flags.language !== undefined) {
      if (languages.indexOf(flags.language as any) === -1) {
        this.error(`Language ${flags.language} is not supported. Supported languages are ${languages}`)
      }
      const components = this.getPluginsByLanguage(flags.language as Language)
      if (devfile.components && components) {
        devfile.components.push(components)
      } else if (components) {
        devfile.components = [components]
      }
    }

    this.log(yaml.safeDump(devfile))

    notifier.notify({
      title: 'chectl',
      message: 'Command devfile:generate has completed successfully.'
    })

    this.exit(0)
  }

  private getPluginsByLanguage(language: Language): DevfileComponent | undefined {
    return LanguagesComponents.get(language)
  }

  private async getDeploymentsBySelector(labelSelector: string, namespace = ''): Promise<Array<V1Deployment>> {
    let items = new Array<V1Deployment>()

    const k8sDeployList = await kube.getDeploymentsBySelector(labelSelector, namespace)
    k8sDeployList.items.forEach(async item => {
      let deployment = new V1Deployment()
      deployment.apiVersion = 'apps/v1'
      deployment.kind = 'Deployment'
      deployment.spec = new V1DeploymentSpec()
      deployment.spec.template = new V1PodTemplateSpec()
      deployment.spec.template.spec = item.spec.template.spec
      await items.push(deployment)
    })

    return items
  }

  private async getServicesBySelector(labelSelector: string, namespace = ''): Promise<Array<V1Service>> {
    let items = new Array<V1Service>()

    const k8sServicesList = await kube.getServicesBySelector(labelSelector, namespace)
    k8sServicesList.items.forEach(async item => {
      let service = new V1Service()
      service.kind = 'Service'
      service.apiVersion = 'v1'
      service.metadata = new V1ObjectMeta()
      service.metadata.labels = item.metadata.labels
      service.metadata.name = item.metadata.name
      service.spec = new V1ServiceSpec()
      service.spec.type = item.spec.type
      service.spec.selector = item.spec.selector
      service.spec.ports = new Array<V1ServicePort>()
      item.spec.ports.forEach(port => {
        let svcPort = new V1ServicePort()
        svcPort.port = port.port
        service.spec.ports.push(svcPort)
      })
      await items.push(service)
    })

    return items
  }

  private async getIngressesBySelector(labelSelector: string, namespace = ''): Promise<Array<V1beta1Ingress>> {
    let items = new Array<V1beta1Ingress>()

    const k8sIngressesList = await kube.getIngressesBySelector(labelSelector, namespace)
    k8sIngressesList.items.forEach(async item => {
      let ingress = new V1beta1Ingress()
      ingress.kind = 'Ingress'
      ingress.apiVersion = 'extv1beta'
      ingress.metadata = new V1ObjectMeta()
      ingress.metadata.labels = item.metadata.labels
      ingress.metadata.name = item.metadata.name
      ingress.spec = item.spec
      await items.push(ingress)
    })

    return items
  }

  private async getPersistentVolumeClaimsBySelector(labelSelector: string, namespace = ''): Promise<Array<V1PersistentVolumeClaim>> {
    let items = new Array<V1PersistentVolumeClaim>()

    const k8sPVCsList = await kube.getPersistentVolumeClaimsBySelector(labelSelector, namespace)
    k8sPVCsList.items.forEach(async item => {
      let pvc = new V1PersistentVolumeClaim()
      pvc.kind = 'Ingress'
      pvc.apiVersion = 'extv1beta'
      pvc.metadata = new V1ObjectMeta()
      pvc.metadata.labels = item.metadata.labels
      pvc.metadata.name = item.metadata.name
      pvc.spec = new V1PersistentVolumeClaimSpec()
      pvc.spec.accessModes = item.spec.accessModes
      pvc.spec.resources = item.spec.resources
      await items.push(pvc)
    })

    return items
  }
}
