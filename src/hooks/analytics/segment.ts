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
import { pick } from 'lodash'

import { ChectlConfig } from '../../api/config/config'

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

/**
 * Class with help methods which help to connect segment and send telemetry data.
 */
export class SegmentAdapter extends ChectlConfig {
  private readonly segment: typeof Analytics
  public confirmation: boolean

  constructor(segmentConfig: SegmentConfig, chectlConfig: IConfig) {
    super(chectlConfig)
    const { segmentWriteKey, ...options } = segmentConfig
    this.segment = new Analytics(segmentWriteKey, options)
    this.confirmation = false
  }

  /**
   * Create a segment track object which includes command properties and some chectl filtred properties
   * @param options chectl information like command or flags.
   * @param segmentID chectl ID generated only if telemetry it is 'on'
   */
  public async trackSegmentEvent(options: {command: string, flags: any}, segmentID: string): Promise<void> {
    this.segment.track({
      anonymousId: segmentID,
      event: options.command.replace(':', ' '),
      properties: {
        ...pick(options.flags, ['platform', 'installer']),
        command: options.command
      },
      // Property which indicate segment will integrate with all configured destinations.
      integrations: {
        All : true
      }
    })
  }

  public generateSegmentID(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}