/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { cli } from 'cli-ux'
import { IConfig } from '@oclif/config'
import { existsSync, mkdirsSync } from 'fs-extra'

import { SegmentAdapter } from './segment'

export const hook = async (options: {event: string, flags: any, command: string, config: IConfig }) => {
  let confirmed

  const segment = new SegmentAdapter({
    // tslint:disable-next-line:no-single-line-block-comment
    segmentWriteKey: /* @mangle */'INSERT-KEY-HERE' /* @/mangle */,
  })

  // Check if exist config dir and if not procceed to create it
  if (!existsSync(options.config.configDir)) {
    mkdirsSync(options.config.configDir)
  }

  // In case if segment info doesn't exist ask user if allow chectl to collect data and store the confirmation in cache
  if (!segment.checkIfSegmentConfigFileExist(options.config.configDir)) {
    confirmed = await cli.confirm('Do you allow chectl to collect anonymous usage data? Please confirm - press y/n')
    segment.storeSegmentConfig(options.config.configDir, confirmed)
  }

  try {
    // If user allow to collect data, chectl start to send the data to segment
    if (confirmed || segment.checkIfSegmentCollectIsAllowed(options.config.configDir)) {
      segment.onTrack(options)
    }
  } catch {
    return this
  }
}
