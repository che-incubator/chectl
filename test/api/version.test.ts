/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { expect, fancy } from 'fancy-test'

import { VersionHelper } from '../../src/api/version'

describe('Version Helper', () => {
  describe('OpenShift API helper', () => {
    fancy
      .it('check minimal version: case #1', async () => {
        const check = VersionHelper.checkMinimalVersion('v2.10', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #2', async () => {
        const check = VersionHelper.checkMinimalVersion('v3.12', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #3', async () => {
        const check = VersionHelper.checkMinimalVersion('v2.11', 'v2.10')
        expect(check).to.true
      })
    fancy
      .it('check minimal version: case #4', async () => {
        const check = VersionHelper.checkMinimalVersion('v2.09', 'v2.10')
        expect(check).to.false
      })
    fancy
      .it('check minimal version: case #5', async () => {
        const check = VersionHelper.checkMinimalVersion('v2.10', 'v3.10')
        expect(check).to.false
      })
  })

  describe('Version Comparator', () => {
    const data = [
      { greater: '8', lesser: '7' },
      { greater: '7', lesser: '7.15' },
      { greater: '7.15', lesser: '7.14' },
      { greater: '7.15', lesser: '7.15.21' },
      { greater: '7.123', lesser: '7.15' },
      { greater: '7.15', lesser: '7.15-RC2' },
      { greater: '7.15-RZ', lesser: '7.15-RA' },
      { greater: '7.123-RC5', lesser: '7.15-RC5' },
      { greater: '7.15-RC2.2', lesser: '7.15-RC2.1' },
      { greater: '7.15.2', lesser: '7.15.1' },
      { greater: '7.15.2.11', lesser: '7.15.2.2' },
      { greater: '7.15.x', lesser: '7.15.9' },
      { greater: '7.15.x', lesser: '7.15.99' },
      { greater: '7.15.x', lesser: '7.15.a' },
      { greater: 'nightly', lesser: 'next' },
      { greater: 'latest', lesser: '7.15' },
      { greater: 'nightly', lesser: '7.15' },
      { greater: 'next', lesser: '88888888' },
      { greater: 'next.nightly', lesser: 'next.next' },
      { greater: 'next.7.123', lesser: 'next.7.55' },
      { greater: 'latest.52', lesser: 'latest.23' },
      { greater: 'latest.123', lesser: 'latest.51' },
      { greater: '7.next', lesser: '7.next.15' },
      { greater: 'v7.123', lesser: '7.15' },
      { greater: '7.123', lesser: 'v7.15' },
      { greater: 'v7.123', lesser: 'v7.15' },
      { greater: 'v7.15.x', lesser: '7.15.9' },
      { greater: '7.15.x', lesser: 'v7.15.9' },
      { greater: 'v7.15.x', lesser: 'v7.15.9' },
      { greater: 'latest', lesser: 'v7.15' },
    ]

    const equalData = [
      '7',
      '7.15',
      '7.15.2',
      '7.15.2.28',
      '7.15.x',
      '7.15-RC2',
      '7.15-RC2.0',
      '7.15-RC2.1.x',
      '7.15-RC2.e1',
      'latest',
      'next',
      'latest.52',
      '7.next',
      '7.next.15',
      'version5',
      'v7.17',
      'v7.5-RC4',
      'vv7.15',
      'v7.10.v8',
    ]

    it('Should recognize first version as greater', () => {
      for (const comparison of data) {
        const lesser = comparison.lesser
        const greater = comparison.greater
        expect(VersionHelper.compareVersions(greater, lesser), `Expected: ${greater} > ${lesser}`).to.equal(1)
      }
    })
    it('Should recognize first version as lesser', () => {
      for (const comparison of data) {
        const lesser = comparison.lesser
        const greater = comparison.greater
        expect(VersionHelper.compareVersions(lesser, greater), `Expected: ${lesser} < ${greater}`).to.equal(-1)
      }
    })
    it('Should recognize equal versions', () => {
      for (const version of equalData) {
        expect(VersionHelper.compareVersions(version, version), `Expected: ${version} === ${version}`).to.equal(0)

        if (!version.startsWith('v') && version.charAt(0) >= '0' && version.charAt(0) <= '9') {
          expect(VersionHelper.compareVersions('v' + version, version), `Expected: v${version} === ${version}`).to.equal(0)
          expect(VersionHelper.compareVersions(version, 'v' + version), `Expected: ${version} === v${version}`).to.equal(0)
          expect(VersionHelper.compareVersions('v' + version, 'v' + version), `Expected: v${version} === v${version}`).to.equal(0)
        }
      }
    })
  })
})
