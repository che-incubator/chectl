/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { pick } from 'lodash'

let Analytics = require('analytics-node')

export interface SegmentConfig {
  segmentWriteKey: string
  flushAt?: number
  flushInterval?: number
}

export interface Flags {
  platform?: string
  installer?: string
}

export namespace SegmentProperties {
  export const Telemetry = 'segment.telemetry'
  export const ID = 'segment.id'
}

/**
 * Class with help methods which help to connect segment and send telemetry data.
 */
export class SegmentAdapter {
  private readonly segment: typeof Analytics
  private readonly id: string

  constructor(segmentConfig: SegmentConfig, segmentId: string) {
    const { segmentWriteKey, ...options } = segmentConfig
    this.segment = new Analytics(segmentWriteKey, options)
    this.id = segmentId
  }

  /**
   * Create a segment track object which includes command properties and some chectl filtred properties
   * @param options chectl information like command or flags.
   * @param segmentID chectl ID generated only if telemetry it is 'on'
   */
  public async trackSegmentEvent(options: { command: string, flags: any }): Promise<void> {
    this.segment.track({
      anonymousId: this.id,
      event: options.command.replace(':', ' '),
      properties: {
        ...pick(options.flags, ['platform', 'installer']),
        command: options.command
      },
      // Property which indicate segment will integrate with all configured destinations.
      integrations: {
        All: true
      }
    })
  }
}
