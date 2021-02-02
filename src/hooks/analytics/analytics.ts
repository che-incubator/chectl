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

import { ConfigManager } from '../../api/config-manager'

import { SegmentAdapter, SegmentProperties } from './segment-adapter'

export const hook = async (options: { command: string, flags: any, config: IConfig }) => {
  // In case of disable telemetry by flag not additional configs are enabled.
  if (options.flags && options.flags.telemetry === 'off') {
    return this
  }

  try {
    const configManager = ConfigManager.getInstance()
    let segmentTelemetry = configManager.getProperty(SegmentProperties.Telemetry)
    let segmentId = configManager.getProperty(SegmentProperties.ID)

    // Prompt question if user allow chectl to collect data anonymous data.
    if (!options.flags.telemetry && !segmentTelemetry) {
      const confirmed = await cli.confirm('Enable CLI usage data to be sent to Red Hat online services. [y/n]')
      segmentTelemetry = confirmed ? 'on' : 'off'
      configManager.setProperty(SegmentProperties.Telemetry, segmentTelemetry)
    }

    // In case of negative confirmation chectl don't collect any data
    if (segmentTelemetry === 'off') {
      return
    }

    // In case if segmentID was not generated, generate new one
    if (!segmentId) {
      segmentId = generateSegmentID()
      configManager.setProperty(SegmentProperties.ID, segmentId)
    }

    const segment = new SegmentAdapter({
      // tslint:disable-next-line:no-single-line-block-comment
      segmentWriteKey: /* @mangle */'INSERT-KEY-HERE' /* @/mangle */,
    }, segmentId)
    await segment.trackSegmentEvent(options)

  } catch {
    return this
  }
}

function generateSegmentID(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}
