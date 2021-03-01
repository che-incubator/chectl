/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { getTimezone } from 'countries-and-timezones'
import * as fs from 'fs-extra'
import { pick } from 'lodash'
import * as os from 'os'
import * as osLocale from 'os-locale'
import * as path from 'path'
import { v4 } from 'uuid'

import { getDistribution, getPlatform, getProjectName, getProjectVersion } from '../../util'

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
   * Returns anonymous id to identify and track chectl events in segment
   */
  static getAnonymousId(): string {
    const anonymousIdPath = path.join(os.homedir(), '.redhat', 'anonymousId')

    if (fs.existsSync(anonymousIdPath)) {
      return fs.readFileSync(anonymousIdPath, 'utf8')
    } else {
      const anonymousId = v4()
      if (!fs.existsSync(anonymousIdPath)) {
        fs.mkdirSync(path.join(os.homedir(), '.redhat'))
      }

      fs.writeFileSync(anonymousIdPath, anonymousId, { encoding: 'utf8' })

      return anonymousId
    }
  }

  /**
   * Identify anonymous user in segment before start to track
   * @param anonymousId Unique identifier
   */
  public async identifySegmentEvent(anonymousId: string): Promise<void> {
    this.segment.identify({
      anonymousId,
      traits: await this.getSegmentIdentifyTraits(),
    })
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

      context: await this.getSegmentEventContext(),
      properties: {
        ...pick(options.flags, ['platform', 'installer']),
        command: options.command,
        version: getProjectVersion()
      },
      // Property which indicate segment will integrate with all configured destinations.
      integrations: {
        All: true
      }
    })
  }

  // Returns basic info about identification in segment
  private async getSegmentIdentifyTraits(): Promise<any> {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      os_name: getPlatform(),
      os_version: os.release(),
      os_distribution: await getDistribution(),
      locale: osLocale.sync().replace('_', '-')
    }
  }

  /**
   * Returns segment event context. Include platform info or countries from where the app was executed
   * More info: https://segment.com/docs/connections/spec/common/#context
   */
  private async getSegmentEventContext(): Promise<any> {
    return {
      ip: '0.0.0.0',
      locale: osLocale.sync().replace('_', '-'),
      app: {
        name: getProjectName(),
        version: getProjectVersion()
      },
      os: {
        name: getPlatform(),
        version: os.release()
      },
      location: {
        country: getTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)?.country || 'XX'
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  }
}
