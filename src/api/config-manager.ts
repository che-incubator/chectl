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

import * as fs from 'fs-extra'
import { merge } from 'lodash'
import * as path from 'node:path'

import { CheCtlContext, CliContext } from '../context'

/**
 * ChectlConfig contains necessary methods to interact with cache configDir of chectl.
 */
export class ConfigManager {
  private static configManager: ConfigManager

  private static readonly CHECTL_CONFIG_FILE_NAME = 'config.json'

  private data: any

  private readonly configPath: string

  private constructor(configDir: string) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirsSync(configDir)
    }

    this.configPath = path.join(configDir, ConfigManager.CHECTL_CONFIG_FILE_NAME)
    this.data = this.readData()
  }

  static getInstance(): ConfigManager {
    if (this.configManager) {
      return this.configManager
    }

    const ctx = CheCtlContext.get()
    const configDir = ctx[CliContext.CLI_CONFIG_DIR]

    this.configManager = new ConfigManager(configDir)
    return this.configManager
  }

  public setProperty(name: string, value: any): void {
    this.data = merge(this.data, { [name]: value })
    fs.writeFileSync(this.configPath, JSON.stringify(this.data))
  }

  public getProperty(name: string): any {
    return this.data[name]
  }

  private readData(): any {
    if (!fs.existsSync(this.configPath)) {
      return {}
    }

    return JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
  }
}
