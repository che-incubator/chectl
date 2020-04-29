/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import axios, { AxiosInstance } from 'axios'
import { Agent } from 'https'
import { stringify } from 'querystring'

import { CheHelper } from '../../../src/api/che'
import { KubeHelper } from '../../../src/api/kube'
import { OpenShiftHelper } from '../../../src/api/openshift'

//Utilities to help e2e tests
export class E2eHelper {
  protected kubeHelper: KubeHelper
  protected che: CheHelper
  protected oc: OpenShiftHelper

  private readonly axios: AxiosInstance
  constructor() {
    this.kubeHelper = new KubeHelper({})
    this.che = new CheHelper({})
    this.oc = new OpenShiftHelper()
    const httpsAgent = new Agent({ rejectUnauthorized: false })

    this.axios = axios.create({
      httpsAgent
    })
  }

  // Return `access_token` from OC/K8s. Receive the platform where che is deployed
  async Access_Token(platform: string): Promise<string> {
    const params = {
      client_id: 'che-public',
      username: 'admin',
      password: 'admin',
      grant_type: 'password'
    }
    try {
      if (platform === 'openshift') {
        const keycloak_url = await this.OC_Hostname('keycloak')
        const endpoint = `${keycloak_url}/auth/realms/che/protocol/openid-connect/token`
        const accessToken = await this.axios.post(endpoint, stringify(params))

        return accessToken.data.access_token
      } else {
        const keycloak_url = await this.K8S_Hostname('keycloak')
        const endpoint = `${keycloak_url}/auth/realms/che/protocol/openid-connect/token`
        const accessToken = await this.axios.post(endpoint, stringify(params))

        return accessToken.data.access_token
      }
    } catch (error) {
      return error
    }
  }

  //Return all workspaces
  async WorkspaceID(platform: string): Promise<any> {
    let workspaces = []
    const maxItems = 30
    let skipCount = 0
    if (platform === 'openshift') {
      const cheUrl = await this.OC_Hostname('che')
      workspaces = await this.che.doGetWorkspaces(cheUrl, skipCount, maxItems, process.env.CHE_ACCESS_TOKEN)
    } else {
      const cheUrl = await this.K8S_Hostname('che')
      workspaces = await this.che.doGetWorkspaces(cheUrl, skipCount, maxItems, process.env.CHE_ACCESS_TOKEN)
    }

    return workspaces
  }

  //Return a route from Openshift adding protocol
  async OC_Hostname(ingress_name: string): Promise<any> {
    if (await this.oc.routeExist(ingress_name, 'che')) {
      try {
        const protocol = await this.oc.getRouteProtocol(ingress_name, 'che')
        const hostname = await this.oc.getRouteHost(ingress_name, 'che')

        return `${protocol}://${hostname}`
      } catch (error) {
        return error
      }
    }
  }

  // Return ingress and protocol from minikube platform
  async K8S_Hostname(ingress_name: string): Promise<any> {
    if (await this.kubeHelper.ingressExist(ingress_name, 'che')) {
      try {
        const protocol = await this.kubeHelper.getIngressProtocol(ingress_name, 'che')
        const hostname = await this.kubeHelper.getIngressHost(ingress_name, 'che')

        return `${protocol}://${hostname}`
      } catch (error) {
        return error
      }
    }
  }
}
