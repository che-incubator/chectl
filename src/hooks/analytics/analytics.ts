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

export const hook = async (options: {command: string, flags: any, config: IConfig }) => {
  //In case of disable telemetry by flag not additional configs are enabled.
  if (options.flags && options.flags.telemetry === 'off') {
    return this
  }

  const segment = new SegmentAdapter({
    // tslint:disable-next-line:no-single-line-block-comment
    segmentWriteKey: /* @mangle */'INSERT-KEY-HERE' /* @/mangle */,
  })

  // Check if exist config dir and if not procceed to create it
  if (!existsSync(options.config.configDir)) {
    mkdirsSync(options.config.configDir)
  }

  try {
    const chectlConfigs = segment.readChectlConfigs(options.config.configDir)
    // Prompt question if user allow chectl to collect data anonymous data.
    if (!options.flags.telemetry && !chectlConfigs.segment.telemetry) {
      segment.confirmation = await cli.confirm('Chectl would like to collect data about how users use cli commands and his flags.Participation is voluntary and when you choose to participate chectl autmatically sends statistic usage about how you use the cli. press y/n')
      chectlConfigs.segment.telemetry = segment.confirmation ? 'on' : 'off'
    }

    // In case of negative confirmation chectl don't collect any data
    if (chectlConfigs.segment.telemetry === 'off') {
      return
    }

    // In case if segmentID was not generated, generate new one
    if (!chectlConfigs.segment.segmentID) {
      chectlConfigs.segment.segmentID = segment.generateSegmentID()
    }

    segment.writeSegmentConfigs(options.config.configDir, chectlConfigs)
    await segment.trackSegmentEvent(options, chectlConfigs.segment.segmentID)
  } catch {
    return this
  }
}
