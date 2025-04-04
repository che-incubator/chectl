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

import { expect, fancy } from 'fancy-test'
import {getImageNameAndTag} from '../../src/utils/utls'
import {Che} from '../../src/utils/che'
import {CheCtlContext, EclipseCheContext} from '../../src/context'

jest.mock("@kubernetes/client-node", () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => {
      return {
        loadFromFile: jest.fn(),
        loadFromDefault: jest.fn(),
        getCurrentContext: jest.fn(),
        setCurrentContext: jest.fn(),
        getContexts: jest.fn(),
        getUserName: jest.fn(),
        getClusterName: jest.fn()
      }
    })
  }
})

describe('Util tests', () => {
  describe('Test getImageNameAndTag', () => {
    // test data format: full image reference, image repository, tag
    const data = [
      ['registry.io/account/image:tag', 'registry.io/account/image', 'tag'],
      ['registry.io/account/image', 'registry.io/account/image', 'latest'],
      ['account/image:4387', 'account/image', '4387'],
      ['docker-registry.default.svc:5000/namespace/operator-image:tag2.6', 'docker-registry.default.svc:5000/namespace/operator-image', 'tag2.6'],
      ['registry.io:5000/account/image', 'registry.io:5000/account/image', 'latest'],
      ['the-image@sha256:12b235c10daa7e4358fe26c4cff725dcf218e0100d680a9722c8ac76170c32ed', 'the-image', 'sha256:12b235c10daa7e4358fe26c4cff725dcf218e0100d680a9722c8ac76170c32ed'],
      ['registry.io/account/image@sha256:82b23dc10daf7e43a8fe26c4cffc25acf268e0110168009722f8ac76170c8ce2', 'registry.io/account/image', 'sha256:82b23dc10daf7e43a8fe26c4cffc25acf268e0110168009722f8ac76170c8ce2'],
      ['registry.io:1234/image@sha256:12b235c10daa7e4358fe26c4cff725dcf218e0100d680a9722c8ac76170c32ed', 'registry.io:1234/image', 'sha256:12b235c10daa7e4358fe26c4cff725dcf218e0100d680a9722c8ac76170c32ed'],
    ]
    fancy.it('Should parse image repository and tag', () => {
      for (const testCaseData of data) {
        const image = testCaseData[0]
        const expectedImageRepo = testCaseData[1]
        const expectedImageTag = testCaseData[2]

        const [imageRepo, imageTag] = getImageNameAndTag(image)

        expect(imageRepo).to.equal(expectedImageRepo)
        expect(imageTag).to.equal(expectedImageTag)
      }
    })
  })

  describe('Test getCheClusterFieldConfigured', () => {
    // test data format: full image reference, image repository, tag
    const data = [
      [{spec: {networking: {auth: {identityProviderURL: 'url'}}}}, 'spec.networking.auth.identityProviderURL', 'url'],
      [{spec: {networking: {auth: {identityProviderURL: ''}}}}, 'spec.networking.auth.identityProviderURL', ''],
      [{spec: {networking: {auth: {}}}}, 'spec.networking.auth.identityProviderURL', undefined],
    ]
    fancy.it('Should get field value', async () => {
      for (const testCaseData of data) {
        const crPatch = testCaseData[0]
        const fieldPath = testCaseData[1] as string
        const expectedFieldValue = testCaseData[2]

        const ctx = await CheCtlContext.get()
        ctx[EclipseCheContext.CR_PATCH] = crPatch

        const actualFieldValue = Che.getCheClusterFieldConfigured(fieldPath)

        expect(actualFieldValue).to.equal(expectedFieldValue)
      }
    })
  })

})
