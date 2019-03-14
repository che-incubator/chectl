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
import { expect, fancy } from 'fancy-test'

import {MinishiftAddonHelper} from '../../src/installers/minishift-addon'

describe('Minishift addon helper', () => {
  fancy
    .it('extracts the tag part from an image name', async () => {
      const image = 'eclipse/che:latest'
      const tag = MinishiftAddonHelper.getImageTag(image)
      expect(tag).to.equal('latest')
    })

  fancy
    .it('extracts the repo part from an image name', async () => {
      const image = 'eclipse/che:latest'
      const repository = MinishiftAddonHelper.getImageRepository(image)
      expect(repository).to.equal('eclipse/che')
    })

  fancy
    .it('returns the repo part even if an image has no tag', async () => {
      const image = 'eclipse/che'
      const repository = MinishiftAddonHelper.getImageRepository(image)
      expect(repository).to.equal('eclipse/che')
    })

  fancy
    .it('returns latest as tag if an image has no tag', async () => {
      const image = 'eclipse/che'
      const tag = MinishiftAddonHelper.getImageTag(image)
      expect(tag).to.equal('latest')
    })

})
