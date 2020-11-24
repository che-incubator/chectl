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
import { pick } from 'lodash'
import * as path from 'path'

import { DEFAULT_CHECTL_CONFIG_FILE_NAME } from '../../constants'

let Analytics = require('analytics-node')

export interface SegmentConfig {
  segmentWriteKey: string
  flushAt?: number
  flushInterval?: number
}

export interface SegmentConfigFile {
  // Get from dataDir if user allow chectl to collect anonymous data
  allowTelemetry?: boolean
}

export interface Flags {
  platform?: string
  installer?: string
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
    this.SEGMENT_CONFIG_FILE = DEFAULT_CHECTL_CONFIG_FILE_NAME
    this.segmentConfig = {}
  }

  /**
   * Create a segment track object which includes command properties and some chectl filtred properties
   * @param options chectl information like command or flags.
   */
  public onTrack(options: {command: string, flags: Flags}): void {
    this.segment.track({
      anonymousId: this.generateAnonymousId(),
      event: options.command,
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

  /**
   * If user accept chectl to collect anonymous data will store the cli confirmation of if allow chectl to
   * collect anonymously usage data. Is usefull to store the confirmation to run cli confirmation in every chectl command
   * @param configDir Chectl config directory https://oclif.io/docs/config
   * @param segmentCollectConfirmation Confirmation true/false of chectl collect data
   */
  public storeSegmentConfig(configDir: string, segmentCollectConfirmation: boolean): void {
    const segmentConfigFile = path.join(configDir, this.SEGMENT_CONFIG_FILE)

    if (!existsSync(segmentConfigFile)) {
      this.segmentConfig.allowTelemetry = segmentCollectConfirmation
      writeFileSync(segmentConfigFile, JSON.stringify(this.segmentConfig))
    }
  }

  /**
   * Function to check if segment configurations exist in chectl config
   * @param configDir Chectl config directory https://oclif.io/docs/config
   */
  public checkIfSegmentConfigFileExist(configDir: string) {
    return existsSync(path.join(configDir, this.SEGMENT_CONFIG_FILE))
  }

  /**
   * Check if user confirmation is stored in chectl config dir
   * @param configDir Chectl config directory https://oclif.io/docs/config
   */
  public checkIfSegmentCollectIsAllowed(configDir: string): boolean {
    const segmentConfigFile = path.join(configDir, this.SEGMENT_CONFIG_FILE)

    if (existsSync(segmentConfigFile)) {
      this.segmentConfig = JSON.parse(readFileSync(segmentConfigFile).toString()) as SegmentConfigFile

      return this.segmentConfig.allowTelemetry || false
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
