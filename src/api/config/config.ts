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
import { existsSync, readFileSync, writeFileSync } from 'fs-extra'
import * as path from 'path'

export interface ChectlConfigs {
  // Segment related configurations
  segment: Segment
}

export interface Segment {
// Unique ID of chectl. It is created only in case if telemetry it is enabled
  segmentID?: string

// Indicate if user confirm or not telemetry in chectl
  telemetry?: string
}

/**
 * ChectlConfig contains necessary methods to interact with cache configDir of chectl.
 */
export class ChectlConfig {
  private readonly CHECTL_CONFIG_FILE_NAME : string
  private chectlConfig: ChectlConfigs
  private readonly config: IConfig
  private readonly CHECTL_CONFIG_FILE_PATH : string

  constructor(config: IConfig) {
    this.CHECTL_CONFIG_FILE_NAME = 'config.json'
    this.chectlConfig = {
      segment: {},
    }
    this.config = config
    this.CHECTL_CONFIG_FILE_PATH = path.join(this.config.configDir, this.CHECTL_CONFIG_FILE_NAME)
  }

  /**
   * Store segment related configurations like if user enable telemetry or segment ID.
   * @param chectlConfigs Object with neccessary chectl configurations to store
   */
  public writeChectlConfigs(chectlConfigs: ChectlConfigs): void {
    this.chectlConfig = chectlConfigs

    writeFileSync(this.CHECTL_CONFIG_FILE_PATH, JSON.stringify(this.chectlConfig))
  }

  /**
   * Get all chectl stored configurations
   */
  public readChectlConfigs(): ChectlConfigs {
    if (!existsSync(this.CHECTL_CONFIG_FILE_PATH)) {
      return this.chectlConfig
    }

    return JSON.parse(readFileSync(this.CHECTL_CONFIG_FILE_PATH).toString()) as ChectlConfigs
  }
}
