import { IConfig } from '@oclif/config'
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

  constructor(config: IConfig) {
    this.CHECTL_CONFIG_FILE_NAME = 'config.json'
    this.chectlConfig = {
      segment: {},
    }
    this.config = config
  }

  /**
   * Store segment related configurations like if user enable telemetry or segment ID.
   * @param chectlConfigs Object with neccessary chectl configurations to store
   */
  public writeChectlConfigs(chectlConfigs: ChectlConfigs): void {
    const chectlConfigFile = path.join(this.config.configDir, this.CHECTL_CONFIG_FILE_NAME)
    this.chectlConfig = chectlConfigs

    writeFileSync(chectlConfigFile, JSON.stringify(this.chectlConfig))
  }

  /**
   * Get all chectl stored configurations
   */
  public readChectlConfigs(): ChectlConfigs {
    const chectlConfigFile = path.join(this.config.configDir, this.CHECTL_CONFIG_FILE_NAME)
    if (!existsSync(chectlConfigFile)) {
      return this.chectlConfig
    }

    return JSON.parse(readFileSync(chectlConfigFile).toString()) as ChectlConfigs
  }
}
