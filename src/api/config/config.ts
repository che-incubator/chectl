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

  constructor() {
    this.CHECTL_CONFIG_FILE_NAME = 'config.json'
    this.chectlConfig = {
      segment: {},
    }
  }

  /**
   * Store segment related configurations like if user enable telemetry or segment ID.
   * @param configDir Configuration directory of chectl. EX. $HOME/.config/chectl
   * @param chectlConfigs Object with neccessary chectl configurations to store
   */
  public writeChectlConfigs(configDir: string, chectlConfigs: ChectlConfigs): void {
    const chectlConfigFile = path.join(configDir, this.CHECTL_CONFIG_FILE_NAME)
    this.chectlConfig = chectlConfigs

    writeFileSync(chectlConfigFile, JSON.stringify(this.chectlConfig))
  }

  /**
   * Get all chectl stored configurations
   * @param configDir Configuration directory of chectl. EX. $HOME/.config/chectl
   */
  public readChectlConfigs(configDir: string): ChectlConfigs {
    const chectlConfigFile = path.join(configDir, this.CHECTL_CONFIG_FILE_NAME)
    if (!existsSync(chectlConfigFile)) {
      return this.chectlConfig
    }

    return JSON.parse(readFileSync(chectlConfigFile).toString()) as ChectlConfigs
  }
}
