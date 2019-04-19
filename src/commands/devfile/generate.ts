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
import * as yaml from 'js-yaml'

import { KubeHelper } from '../../api/kube'

import { Devfile, DevfileComponent, TheEndpointName } from '../../api/devfile'

const stringLitArray = <L extends string>(arr: L[]) => arr
const languages = stringLitArray(['java', 'typescript', 'go', 'python', 'c#'])
export type Language = (typeof languages)[number]

const LanguagesComponents = new Map<Language, DevfileComponent>([
  ['java', {type: TheEndpointName.ChePlugin, name: 'java-ls', id: 'org.eclipse.che.vscode-redhat.java:0.38.0'}],
  ['typescript', {type: TheEndpointName.ChePlugin, name: 'typescript-ls', id: 'ms-vscode.typescript:1.30.2'}],
  ['go', {type: TheEndpointName.ChePlugin, name: 'go-ls', id: 'ms-vscode.go:0.9.2'}],
  ['python', {type: TheEndpointName.ChePlugin, name: 'python-ls', id: 'ms-python.python:2019.2.5433'}],
  ['c#', {type: TheEndpointName.ChePlugin, name: 'csharp-ls', id: 'che-omnisharp-plugin:0.0.1'}],
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
    const kube = new KubeHelper()
    let devfile: Devfile = {
      specVersion: '0.0.1',
      name: 'chectl-generated'
    }

    if (flags.selector !== undefined) {
      let k8sDeploy = await kube.getDeploymentsBySelector(flags.selector, flags.namespace)
      const component: DevfileComponent = {
        type: TheEndpointName.Kubernetes,
        name: k8sDeploy.metadata.selfLink,
        referenceContent: `${JSON.stringify(k8sDeploy)}`
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
  }

  private getPluginsByLanguage(language: Language): DevfileComponent | undefined {
    return LanguagesComponents.get(language)
  }
}
