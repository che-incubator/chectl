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

import { V1beta1Ingress, V1Deployment, V1DeploymentSpec, V1ObjectMeta, V1PersistentVolumeClaim, V1PersistentVolumeClaimSpec, V1PodTemplateSpec, V1Service, V1ServicePort, V1ServiceSpec } from '@kubernetes/client-node'
import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as yaml from 'js-yaml'

import { Devfile, DevfileCommand, DevfileComponent, DevfileProject, ProjectSource, TheEndpointName } from '../../api/devfile'
import { KubeHelper } from '../../api/kube'
let kube: KubeHelper
const stringLitArray = <L extends string>(arr: L[]) => arr
const languages = stringLitArray(['java', 'typescript', 'go', 'python', 'c#'])
export type Language = (typeof languages)[number]
const editors = stringLitArray(['theia-next', 'theia-1.0.0'])
export type Editor = (typeof editors)[number]

const LanguagesComponents = new Map<Language, DevfileComponent>([
  ['java', {type: TheEndpointName.ChePlugin, alias: 'java-ls', id: 'redhat/java/latest'}],
  ['typescript', {type: TheEndpointName.ChePlugin, alias: 'typescript-ls', id: 'che-incubator/typescript/latest'}],
  ['go', {type: TheEndpointName.ChePlugin, alias: 'go-ls', id: 'ms-vscode/go/latest'}],
  ['python', {type: TheEndpointName.ChePlugin, alias: 'python-ls', id: 'ms-python/python/latest'}],
  ['c#', {type: TheEndpointName.ChePlugin, alias: 'csharp-ls', id: 'redhat-developer/che-omnisharp-plugin/latest'}],
])

const EditorComponents = new Map<Editor, DevfileComponent>([
  ['theia-next', { type: TheEndpointName.CheEditor, alias: 'theia-editor', id: 'eclipse/che-theia/next' }],
  ['theia-1.0.0', { type: TheEndpointName.CheEditor, alias: 'theia-editor', id: 'eclipse/che-theia/1.0.0' }]
])

export default class Generate extends Command {
  static description = 'generate and print a devfile to stdout given some Kubernetes resources and other Che workspaces features (project, language-support, commands etc...)'

  static flags = {
    help: flags.help({ char: 'h' }),
    name: string({
      description: 'Workspace name',
      default: '',
      env: 'WSNAME',
      required: false,
    }),
    dockerimage: string({
      description: 'dockerimage component to include in the Devfile',
      env: 'DOCKERIMAGE',
      required: false,
    }),
    namespace: string({
      description: 'Kubernetes namespace where the resources are defined',
      default: '',
      env: 'NAMESPACE',
      required: false,
    }),
    editor: string({
      description: `Specify the Che editor component. Currently supported editors: ${editors}`,
      env: 'EDITOR',
      required: false,
    }),
    selector: string({
      description: 'label selector to filter the Kubernetes resources. For example --selector="app.kubernetes.io/name=employee-manager"',
      env: 'SELECTOR',
      required: false,
    }),
    language: string({
      description: `Add support for a particular language. Currently supported languages: ${languages}`,
      env: 'LANGUAGE_SUPPORT',
      required: false,
    }),
    plugin: string({
      description: 'Che plugin to include in the workspace. The format is JSON. For example this is a valid Che Plugin specification: {"type": "TheEndpointName.ChePlugin", "alias": "java-ls", "id": "redhat/java/0.38.0"}',
      env: 'CHE_PLUGIN',
      required: false,
    }),
    'git-repo': string({
      description: 'Source code git repository to include in the workspace',
      env: 'GIT_REPO',
      required: false,
    }),
    command: string({
      description: 'Command to include in the workspace',
      env: 'COMMAND',
      required: false,
    }),
  }

  async run() {
    const { flags } = this.parse(Generate)
    kube = new KubeHelper(flags)
    const notifier = require('node-notifier')

    let name = flags.name || 'chectl-generated'

    let devfile: Devfile = {
      apiVersion: '1.0.0',
      metadata: {
        name
      }
    }

    if (flags['git-repo'] !== undefined) {
      const repo: ProjectSource = {
        type: 'git',
        location: flags['git-repo']
      }

      const project: DevfileProject = {
        source: repo,
        name: flags['git-repo'].split('/').pop() || 'git-project'
      }

      if (devfile.projects) {
        devfile.projects.push(project)
      } else {
        devfile.projects = [project]
      }
    }

    if (flags.dockerimage !== undefined) {
      const component: DevfileComponent = {
        alias: `${flags.dockerimage.replace(/[\.\/:]/g, '-').substring(0, 20)}`,
        type: TheEndpointName.Dockerimage,
        image: `${flags.dockerimage}`,
        memoryLimit: '512M',
        mountSources: true,
        command: ['tail'],
        args: ['-f', '/dev/null']
      }
      if (devfile.components) {
        devfile.components.push(component)
      } else {
        devfile.components = [component]
      }
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
        referenceContent: `${yaml.safeDump(k8sList, { skipInvalid: true })}`
      }
      if (devfile.components) {
        devfile.components.push(component)
      } else {
        devfile.components = [component]
      }
    }

    if (flags.plugin !== undefined) {
      if (devfile.components) {
        devfile.components.push(JSON.parse(flags.plugin))
      } else {
        devfile.components = [JSON.parse(flags.plugin)]
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

    if (flags.editor !== undefined) {
      if (editors.indexOf(flags.editor as any) === -1) {
        this.error(`Editor ${flags.editor} is not supported. Supported editors are ${editors}`)
      }
      const components = EditorComponents.get(flags.editor as Editor)
      if (devfile.components && components) {
        devfile.components.push(components)
      } else if (components) {
        devfile.components = [components]
      }
    }

    if (flags.command !== undefined && devfile.components && devfile.components.length > 0) {
      let workdir = '/projects/'
      if (devfile.projects && devfile.projects.length > 0) {
        workdir += devfile.projects[0].name
      }

      const command: DevfileCommand = {
        name: `${flags.command}`,
        actions: [
          {
            type: 'exec',
            command: `${flags.command}`,
            component: `${devfile.components[0].alias}`,
            workdir
          }
        ]
      }

      if (devfile.commands) {
        devfile.commands.push(command)
      } else {
        devfile.commands = [command]
      }
    }

    // Add header
    this.log('# Generated by chectl (see https://github.com/che-incubator/chectl):')
    // only arguments after devfile:generate
    const index = process.argv.indexOf('devfile:generate')
    const updatedArgs = process.argv.slice(index).map(arg => {
      if (arg.indexOf(' ') >= 0) {
        return arg.replace(/(.*?)=(.*)/g, '$1=\"$2\"')
      } else {
        return arg
      }
    })
    this.log(`# chectl ${updatedArgs.join(' ')}`)
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
      deployment.metadata = new V1ObjectMeta()
      deployment.metadata.labels = {...item.metadata.labels}
      deployment.metadata.name = item.metadata.name
      deployment.spec = new V1DeploymentSpec()
      deployment.spec.selector = item.spec.selector
      deployment.spec.template = new V1PodTemplateSpec()
      deployment.spec.template.metadata = new V1ObjectMeta()
      deployment.spec.template.metadata.labels = {...item.spec.template.metadata.labels}
      deployment.spec.template.metadata.name = item.spec.template.metadata.name
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
      service.metadata.labels = {...item.metadata.labels}
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
      ingress.apiVersion = 'extensions/v1beta1'
      ingress.metadata = new V1ObjectMeta()
      ingress.metadata.labels = {...item.metadata.labels}
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
      pvc.kind = 'PersistentVolumeClaim'
      pvc.apiVersion = 'v1'
      pvc.metadata = new V1ObjectMeta()
      pvc.metadata.labels = {...item.metadata.labels}
      pvc.metadata.name = item.metadata.name
      pvc.spec = new V1PersistentVolumeClaimSpec()
      pvc.spec.accessModes = item.spec.accessModes
      pvc.spec.resources = item.spec.resources
      await items.push(pvc)
    })

    return items
  }
}
