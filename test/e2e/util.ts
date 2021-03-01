/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as execa from 'execa'

import { CheHelper } from '../../src/api/che'
import { KubeHelper } from '../../src/api/kube'
import { OpenShiftHelper } from '../../src/api/openshift'
import { DEFAULT_OLM_SUGGESTED_NAMESPACE } from '../../src/constants'

// Fields which chectl returns for workspace:list commands
interface WorkspaceInfo {
  id: string
  name: string
  namespace: string
  status: string
}

const binChectl = `${process.cwd()}/bin/run`

export const DEVFILE_URL = 'https://raw.githubusercontent.com/eclipse/che-devfile-registry/master/devfiles/quarkus/devfile.yaml'

export const NAMESPACE = 'eclipse-che'
export const NIGHTLY = 'nightly'

//Utilities to help e2e tests
export class E2eHelper {
  protected kubeHelper: KubeHelper
  protected che: CheHelper
  protected oc: OpenShiftHelper
  protected devfileName: string

  constructor() {
    this.kubeHelper = new KubeHelper({})
    this.che = new CheHelper({})
    // generate-name from https://raw.githubusercontent.com/eclipse/che-devfile-registry/master/devfiles/quarkus/devfile.yaml
    this.devfileName = 'quarkus-'
    this.oc = new OpenShiftHelper()
  }

  async runCliCommand(command: string, args?: string[], printOutput = true): Promise<string> {
    if (printOutput) {
      // tslint:disable-next-line: no-console
      console.log(`Running command: ${command} ${args ? args.join(' ') : ''}`)
    }

    const { exitCode, stdout, stderr } = await execa(command, args, { shell: true })

    if (printOutput) {
      // tslint:disable-next-line: no-console
      console.log(stdout)
      if (exitCode !== 0) {
        // tslint:disable-next-line: no-console
        console.log(stderr)
      }
    }

    expect(exitCode).toEqual(0)

    return stdout
  }

  // Return an array with all user workspaces
  // async getAllWorkspaces(isOpenshiftPlatformFamily: string): Promise<chetypes.workspace.Workspace[]> {
  private async getAllWorkspaces(): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = []
    const { stdout } = await execa(binChectl, ['workspace:list', `--chenamespace=${DEFAULT_OLM_SUGGESTED_NAMESPACE}`, '--telemetry=off'], { shell: true })
    const regEx = new RegExp('[A-Za-z0-9_-]+', 'g')
    for (const line of stdout.split('\n')) {
      const items = line.match(regEx)
      if (items && items.length > 0 && !items[0].startsWith('Id') && !items[0].startsWith('Current')) {
        workspaces.push({
          id: items[0],
          name: items[1],
          namespace: items[2],
          status: items[3],
        })
      }
    }
    return workspaces
  }

  // Return id of test workspaces(e2e-tests. Please look devfile-example.yaml file)
  async getWorkspaceId(): Promise<any> {
    const workspaces = await this.getAllWorkspaces()
    const workspaceId = workspaces.filter((wks => wks.name.match(this.devfileName))).map(({ id }) => id)[0]

    if (!workspaceId) {
      throw Error('Error getting workspaceId')
    }

    return workspaceId
  }

  // Return the status of test workspaces(e2e-tests. Please look devfile-example.yaml file)
  async getWorkspaceStatus(): Promise<any> {
    const workspaces = await this.getAllWorkspaces()
    const workspaceStatus = workspaces.filter((wks => wks.name.match(this.devfileName))).map(({ status }) => status)[0]

    if (!workspaceStatus) {
      throw Error('Error getting workspace_id')

    }

    return workspaceStatus
  }

  async waitWorkspaceStatus(status: string, timeoutMs: number): Promise<boolean> {
    const delayMs = 1000 * 5

    let totalTimeMs = 0
    while (totalTimeMs < timeoutMs) {
      if (await this.getWorkspaceStatus() === status) {
        return true
      }
      await this.sleep(delayMs)
      totalTimeMs += delayMs
    }
    return false
  }

  //Return a route from Openshift adding protocol
  async OCHostname(ingressName: string, namespace: string): Promise<string> {
    if (await this.oc.routeExist(ingressName, namespace)) {
      const protocol = await this.oc.getRouteProtocol(ingressName, namespace)
      const hostname = await this.oc.getRouteHost(ingressName, namespace)

      return `${protocol}://${hostname}`
    }
    throw new Error('Route "che" does not exist')
  }

  // Return ingress and protocol from minikube platform
  async K8SHostname(ingressName: string, namespace: string): Promise<string> {
    if (await this.kubeHelper.ingressExist(ingressName, namespace)) {
      const protocol = await this.kubeHelper.getIngressProtocol(ingressName, namespace)
      const hostname = await this.kubeHelper.getIngressHost(ingressName, namespace)

      return `${protocol}://${hostname}`
    }
    throw new Error(`Ingress "${ingressName}" in namespace ${namespace} does not exist`)
  }

  // Utility to wait a time
  sleep(ms: number): Promise<any> {
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async waitForVersionInCheCR(version: string, timeoutMs: number): Promise<void> {
    const delayMs = 5 * 1000

    let totalTimeMs = 0
    while (totalTimeMs < timeoutMs) {
      const cheCR = await this.kubeHelper.getCheCluster(NAMESPACE)
      if (cheCR && cheCR.status && cheCR.status.cheVersion === version) {
        return
      }
      await this.sleep(delayMs)
      totalTimeMs += delayMs
    }
    throw new Error(`Che CR version ${version} has not appeared in ${timeoutMs / 1000}s`)
  }

  async waitForCheServerImageTag(tag: string, timeoutMs: number): Promise<void> {
    const delayMs = 5 * 1000
    const chePodNameRegExp = new RegExp('che-[0-9a-f]+-.*')

    let totalTimeMs = 0
    while (totalTimeMs < timeoutMs) {
      const pods = (await this.kubeHelper.listNamespacedPod(NAMESPACE)).items
      const pod = pods.find((pod => pod.metadata && pod.metadata.name && pod.metadata.name.match(chePodNameRegExp)))
      if (pod && pod.status && pod.status.containerStatuses && pod.status.containerStatuses[0].image) {
        const imageTag = pod.status.containerStatuses[0].image.split(':')[1]
        if (imageTag === tag) {
          return
        }
      }
      await this.sleep(delayMs)
      totalTimeMs += delayMs
    }
    throw new Error(`Che server image tag ${tag} has not appeared in ${timeoutMs / 1000}s `)
  }

}
