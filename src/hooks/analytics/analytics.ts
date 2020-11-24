/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { IConfig } from '@oclif/config'
import { cli } from 'cli-ux'
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
    // In case of telemetry confirmation it is enabled from flags we don't store the confirmation in chectl cache config
    if (options.flags && options.flags.telemetry === 'on') {
      confirmed = true
    } else if (options.flags && options.flags.telemetry === 'off') {
      confirmed = false
    } else {
      confirmed = await cli.confirm('Chectl would like to collect data about how users use cli commands and his flags.Participation is voluntary and when you choose to participate chectl autmatically sends statistic usage about how you use the cli. press y/n')
      segment.storeSegmentConfig(options.config.configDir, confirmed)
    }
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
