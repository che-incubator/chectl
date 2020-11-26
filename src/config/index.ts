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

import { DEFAULT_CHECTL_CONFIG_FILE_NAME } from '../constants'

import { ChectlConfigs, Segment } from './typings/config'

/**
 * ChectlConfig contains necessary methods to interact with cache configDir of chectl.
 */
export class ChectlConfig {
  private readonly CHECTL_CONFIG_FILE_NAME : string
  private readonly chectlConfig: ChectlConfigs

  constructor() {
    this.CHECTL_CONFIG_FILE_NAME = DEFAULT_CHECTL_CONFIG_FILE_NAME
    this.chectlConfig = {
      segment: {},
    }
  }
/**
 * Store segment related configurations like if user enable telemetry or segment ID.
 * @param configDir Configuration directory of chectl. EX. $HOME/.config/chectl
 * @param segmentConfigs Object with neccessary segment configurations
 */
  public storeSegmentConfigs(configDir: string, segmentConfigs: Segment): void {
    const chectlConfigFile = path.join(configDir, this.CHECTL_CONFIG_FILE_NAME)
    this.chectlConfig.segment = segmentConfigs

    writeFileSync(chectlConfigFile, JSON.stringify(this.chectlConfig))
  }

  /**
   * Get all chectl stored configurations
   * @param configDir Configuration directory of chectl. EX. $HOME/.config/chectl
   */
  public getChectlConfigs(configDir: string): ChectlConfigs {
    const chectlConfigFile = path.join(configDir, this.CHECTL_CONFIG_FILE_NAME)
    if (!existsSync(chectlConfigFile)) {
      return this.chectlConfig
    }

    return JSON.parse(readFileSync(chectlConfigFile).toString()) as ChectlConfigs
  }
}
