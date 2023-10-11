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
import { getTimezone } from 'countries-and-timezones'
import * as fs from 'fs-extra'
import { pick } from 'lodash'
import * as os from 'node:os'
import * as osLocale from 'os-locale'
import * as path from 'node:path'
import { v4 } from 'uuid'

import {getProjectName, getProjectVersion} from '../../utils/utls'
import * as getos from 'getos'
import {promisify} from 'node:util'

const Analytics = require('analytics-node')

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
   * Check if exists an anonymousId in file: $HOME/.redhat/anonymousId and if not generate new one in this location
   */
  static getAnonymousId(): string | undefined {
    const anonymousIdPath = path.join(os.homedir(), '.redhat', 'anonymousId')
    let anonymousId = v4()
    try {
      if (fs.existsSync(anonymousIdPath)) {
        anonymousId = fs.readFileSync(anonymousIdPath, 'utf8')
      } else {
        if (!fs.existsSync(anonymousIdPath)) {
          fs.mkdirSync(path.join(os.homedir(), '.redhat'))
        }

        fs.writeFileSync(anonymousIdPath, anonymousId, { encoding: 'utf8' })
      }
    } catch (error) {
      ux.debug(`Failed to store anonymousId ${error}`)
    }

    return anonymousId.trim()
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
        version: getProjectVersion(),
      },
      // Property which indicate segment will integrate with all configured destinations.
      integrations: {
        All: true,
      },
    })
  }

  // Returns basic info about identification in segment
  private async getSegmentIdentifyTraits(): Promise<any> {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      os_name: os.platform(),
      os_version: os.release(),
      os_distribution: this.getDistribution(),
      locale: osLocale.sync().replace('_', '-'),
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
      },
      os: {
        name: os.platform(),
        version: os.release(),
      },
      location: {
        country: this.getCountry(Intl.DateTimeFormat().resolvedOptions().timeZone),
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  }

  private async getDistribution(): Promise<string | undefined> {
    if (os.platform() === 'linux') {
      try {
        const platform = await promisify(getos)() as getos.LinuxOs
        return platform.dist
      } catch {
        return
      }
    }

    return
  }

  private getCountry(timeZone: string): string {
    const tz = getTimezone(timeZone)
    if (tz && tz?.countries) {
      return tz.countries[0]
    }

    // Probably UTC timezone
    return 'ZZ' // Unknown country
  }
}
