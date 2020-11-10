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

// Fields which chectl returns for workspace:list commands
interface WorkspaceInfo {
  id: string
  name: string
  namespace: string
  status: string
}

const binChectl = `${process.cwd()}/bin/run`

//Utilities to help e2e tests
export class E2eHelper {
  protected kubeHelper: KubeHelper
  protected che: CheHelper
  protected oc: OpenShiftHelper
  protected devfileName: string

  constructor() {
    this.kubeHelper = new KubeHelper({})
    this.che = new CheHelper({})
    this.devfileName = 'e2e-tests'
    this.oc = new OpenShiftHelper()
  }

  // Return an array with all user workspaces
  // async getAllWorkspaces(isOpenshiftPlatformFamily: string): Promise<chetypes.workspace.Workspace[]> {
  private async getAllWorkspaces(): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = []
    const { stdout } = await execa(binChectl, ['workspace:list'], { timeout: 10000 })
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
    const workspaceId = workspaces.filter((wks => wks.name === this.devfileName)).map(({ id }) => id)[0]

    if (!workspaceId) {
      throw Error('Error getting workspaceId')
    }

    return workspaceId
  }

  // Return the status of test workspaces(e2e-tests. Please look devfile-example.yaml file)
  async getWorkspaceStatus(): Promise<any> {
    const workspaces = await this.getAllWorkspaces()
    const workspaceStatus = workspaces.filter((wks => wks.name === this.devfileName)).map(({ status }) => status)[0]

    if (!workspaceStatus) {
      throw Error('Error getting workspace_id')

    }

    return workspaceStatus
  }

  //Return a route from Openshift adding protocol
  async OCHostname(ingressName: string): Promise<string> {
    if (await this.oc.routeExist(ingressName, 'che')) {
      const protocol = await this.oc.getRouteProtocol(ingressName, 'che')
      const hostname = await this.oc.getRouteHost(ingressName, 'che')

      return `${protocol}://${hostname}`
    }
    throw new Error('Route "che" does not exist')
  }

  // Return ingress and protocol from minikube platform
  async K8SHostname(ingressName: string): Promise<string> {
    const namespace = 'che'
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
}
