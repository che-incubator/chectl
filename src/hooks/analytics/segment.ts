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

export interface SegmentConfig {
  segmentWriteKey: string
  flushAt?: number
  flushInterval?: number
}

export interface SegmentConfigFile {
  // Get from dataDir if user allow chectl to collect anonymous data
  allowChectlToCollectData?: boolean
}

/**
 * Class with help methods which help to connect to send telemetry data to segment.
 */
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

  /**
   * 
   * @param options 
   */
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

  /**
   * If user accept chectl to collect anonymous data will store the cli confirmation of if allow chectl to
   * collect anonymously usage data. Is usefull to store the confirmation to run cli confirmation in every chectl command
   * @param configDir Chectl config directory https://oclif.io/docs/config
   * @param segmentCollectConfirmation Confirmation true/false of chectl collect data
   */
  public storeSegmentConfig(configDir: string, segmentCollectConfirmation: boolean): void {
    if (!existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)) {
      this.segmentConfig.allowChectlToCollectData = segmentCollectConfirmation
      writeFileSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`, JSON.stringify(this.segmentConfig))
    }
  }

  /**
   * Function to check if segment configurations exist in chectl config
   * @param configDir Chectl config directory https://oclif.io/docs/config
   */
  public checkIfSegmentConfigFileExist(configDir: string) {
    return existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)
  }

  /**
   * Check if user confirmation is stored in chectl config dir
   * @param configDir Chectl config directory https://oclif.io/docs/config
   */
  public checkIfSegmentCollectIsAllowed(configDir: string): boolean {
    if (existsSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`)) {
      this.segmentConfig = JSON.parse(readFileSync(`${configDir}/${this.SEGMENT_CONFIG_FILE}`).toString()) as SegmentConfigFile

      return this.segmentConfig.allowChectlToCollectData || false
    }

    return false
  }

  /**
   * Generate an anonymous id for every event tracked in segment
   */
  private generateAnonymousId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}
