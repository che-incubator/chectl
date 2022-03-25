/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { fancy } from 'fancy-test'

import { KubeHelper } from '../../src/api/kube'

const namespace = 'che'
const kubeClusterURL = 'https://fancy-kube-cluster:8443'
const kubeContext = `apiVersion: v1
clusters:
- cluster:
    server: ${kubeClusterURL}
  name: minikube
contexts:
- context:
    cluster: minikube
    namespace: che
    user: minikube
  name: minikube
current-context: minikube
kind: Config
preferences: {}
users:
- name: minikube`

const kube = new KubeHelper({})
kube.kubeConfig.loadFromString(kubeContext)

describe('Kube API helper', () => {
  fancy
    .nock(kubeClusterURL, api => api
      .get(`/api/v1/namespaces/${namespace}/pods?labelSelector=app%3Dche`)
      .times(2)
      .replyWithFile(200, __dirname + '/replies/get-pod-by-selector-running.json', { 'Content-Type': 'application/json' })
      .get(`/api/v1/namespaces/${namespace}/pods?labelSelector=app%3Dche`)
      .replyWithFile(200, __dirname + '/replies/get-pod-by-selector-running-ready.json', { 'Content-Type': 'application/json' }))
    .it('waits until the pod Ready status is "True"', async () => {
      const selector = 'app=che'
      const interval = 10
      const timeout = 1000
      await kube.waitForPodReady(selector, namespace, interval, timeout)
    })
  fancy
    .nock(kubeClusterURL, api => api
      .get('/healthz')
      .reply(200, 'ok'))
    .it('verifies that kuber API is ok via public healthz endpoint', async () => {
      await kube.checkKubeApi()
    })
  fancy
    .nock(kubeClusterURL, api => api
      .get('/healthz')
      .matchHeader('Authorization', val => !val)
      .reply(401, 'token is missing')
      .get('/api/v1/namespaces/default/secrets')
      .replyWithFile(200, __dirname + '/replies/get-secrets.json', { 'Content-Type': 'application/json' })
      .get('/healthz')
      .reply(200, 'ok'))
    .it('verifies that kuber API is ok via secure healthz endpoint', async () => {
      await kube.checkKubeApi()
    })
})
