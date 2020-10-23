/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { che as chetypes } from '@eclipse-che/api'

import { CheHelper } from '../../../src/api/che'
import { CheApiClient } from '../../../src/api/che-api-client'
import { CheServerLoginManager } from '../../../src/api/che-login-manager'
import { KubeHelper } from '../../../src/api/kube'
import { OpenShiftHelper } from '../../../src/api/openshift'

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

  //Return an array with all workspaces
  async getAllWorkspaces(isOpenshiftPlatformFamily: string): Promise<chetypes.workspace.Workspace[]> {
    let cheApiEndpoint: string
    if (isOpenshiftPlatformFamily === 'openshift') {
      cheApiEndpoint = await this.OCHostname('che') + '/api'
    } else {
      cheApiEndpoint = await this.K8SHostname('che') + '/api'
    }

    // Login manager is always present as it is invoked first in the actual chectl command
    const cheLoginManager = (await CheServerLoginManager.getInstance())!
    const accessToken = await cheLoginManager.getNewAccessToken()
    return CheApiClient.getInstance(cheApiEndpoint).getAllWorkspaces(accessToken)
  }

  // Return id of test workspaces(e2e-tests. Please look devfile-example.yaml file)
  async getWorkspaceId(platform: string): Promise<any> {
    const workspaces = await this.getAllWorkspaces(platform)
    const workspaceId = workspaces.filter((wks => wks!.devfile!.metadata!.name === this.devfileName)).map(({ id }) => id)[0]

    if (!workspaceId) {
      throw Error('Error getting workspaceId')
    }

    return workspaceId
  }

  // Return the status of test workspaces(e2e-tests. Please look devfile-example.yaml file)
  async getWorkspaceStatus(platform: string): Promise<any> {
    const workspaces = await this.getAllWorkspaces(platform)
    const workspaceStatus = workspaces.filter((wks => wks!.devfile!.metadata!.name === this.devfileName)).map(({ status }) => status)[0]

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
    if (await this.kubeHelper.ingressExist(ingressName, 'che')) {
      const protocol = await this.kubeHelper.getIngressProtocol(ingressName, 'che')
      const hostname = await this.kubeHelper.getIngressHost(ingressName, 'che')

      return `${protocol}://${hostname}`
    }
    throw new Error('Ingress "che" does not exist')
  }

  // Utility to wait a time
  SleepTests(ms: number): Promise<any> {
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
