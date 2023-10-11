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

import { ux } from '@oclif/core'

import { ConfigManager } from '../../api/config-manager'

import { SegmentAdapter, SegmentProperties } from './segment-adapter'

export const hook = async (options: { command: string, flags: any }) => {
  // In case of disable telemetry by flag not additional configs are enabled.
  if (options.flags && options.flags.telemetry === 'off') {
    return this
  }

  try {
    const configManager = ConfigManager.getInstance()
    let segmentTelemetry = configManager.getProperty(SegmentProperties.Telemetry)

    // Prompt question if user allow chectl to collect data anonymous data.
    if (!options.flags.telemetry && !segmentTelemetry) {
      // Do not ask for enabling telemetry in batch mode. Just skip it if the telemetry flag is not set.
      if (options.flags.batch) {
        return
      }

      const confirmed = await ux.confirm('Enable CLI usage data to be sent to Red Hat online services. More info: https://developers.redhat.com/article/tool-data-collection [y/n]')
      segmentTelemetry = confirmed ? 'on' : 'off'
      configManager.setProperty(SegmentProperties.Telemetry, segmentTelemetry)
    }

    // If not confirmed, chectl doesn't collect any data.
    if (segmentTelemetry !== 'on') {
      return
    }

    const segmentId = SegmentAdapter.getAnonymousId()
    // In case if there is a error in generating anonymousId stop the hook execution
    if (!segmentId) {
      return
    }

    const segment = new SegmentAdapter({
      // tslint:disable-next-line:no-single-line-block-comment
      segmentWriteKey: /* @mangle */'INSERT-KEY-HERE' /* @/mangle */,
    }, segmentId)

    await segment.identifySegmentEvent(segmentId)
    await segment.trackSegmentEvent(options)
  } catch {
    return this
  }
}
