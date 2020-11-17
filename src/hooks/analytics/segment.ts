/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { existsSync, readFileSync, writeFileSync } from 'fs-extra'

let Analytics = require('analytics-node')

interface SegmentConfig {
  segmentWriteKey: string
  flushAt?: number
  flushInterval?: number
}

export interface SegmentConfigFile {
  // Get from dataDir if user allow chectl to collect anonymous data
  allowChectlToCollectData?: boolean
}

export class SegmentAdapter {
  private readonly segment: typeof Analytics
  private readonly SEGMENT_CONFIG_FILE : string
  private segmentConfig: SegmentConfigFile

  constructor(config: SegmentConfig) {
    const { segmentWriteKey, ...options } = config
    this.segment = new Analytics(segmentWriteKey, options)
    this.SEGMENT_CONFIG_FILE = 'segment.json'
    this.segmentConfig = {}
  }

  public onTrack(options: {event: string, command: string, flags: any}) {
    this.segment.track({
      anonymousId: this.generateAnonymousId(),
      event: options.event,
      properties: {
        command: options.command,
        flags: options.flags,
      },
    } as any)
    return this
  }

  public storeSegmentConfig(configDir: string, segmentCollectConfirmation: boolean): void {
    if (!existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)) {
      this.segmentConfig.allowChectlToCollectData = segmentCollectConfirmation
      writeFileSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`, JSON.stringify(this.segmentConfig))
    }
  }

  public checkIfSegmentConfigFileExist(configDir: string) {
    return existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)
  }

  public checkIfSegmentCollectIsAllowed(configDir: string): boolean {
    if (existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)) {
      this.segmentConfig = JSON.parse(readFileSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`).toString()) as SegmentConfigFile

      return this.segmentConfig.allowChectlToCollectData || false
    }

    return false
  }

  private generateAnonymousId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}
