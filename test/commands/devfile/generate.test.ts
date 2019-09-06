/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { expect, test } from '@oclif/test'

// const namespace = 'che'
// const kubeClusterURL = 'https://fancy-kube-cluster:8443'

describe('devfile:generate', () => {
  test
    // .nock(kubeClusterURL, api => api
    //   .get(`/apis/apps/v1/namespaces/${namespace}/deployments?pretty=true&includeUninitialized=true&labelSelector=app%3Dguestbook`)
    //   .replyWithFile(200, __dirname + '/replies/get-deployment-by-selector.json', { 'Content-Type': 'application/json' }))
    .stdout()
    .command(['devfile:generate', '--selector', 'app=redis'])
    .exit(0)
    .it('generates a Devfile', ctx => {
      expect(ctx.stdout).to.contain('kind: List')
    })
})
