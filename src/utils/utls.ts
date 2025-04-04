/**
 * Copyright (c) 2019-2022 Red Hat, Inc.
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
import * as os from 'node:os'
import * as yaml from 'js-yaml'
import * as path from 'node:path'
import { CheCtlContext } from '../context'
import * as Listr from 'listr'
import { LISTR_RENDERER_FLAG } from '../flags'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'
import { CHE } from '../constants'
import * as commandExists from 'command-exists'
import execa = require('execa')

const pkjson = require('../../package.json')

export function base64Decode(arg: string): string {
  return Buffer.from(arg, 'base64').toString('ascii')
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export function newError(message: string, cause: Error): Error {
  const error = new Error(message) as any
  error.cause = cause
  error.stack += `\nCause: ${cause.stack}`
  return error
}

export function getProjectName(): string {
  return pkjson.name
}

export function getProjectVersion(): string {
  return pkjson.version
}

export function safeLoadFromYamlFile(filePath: string): any {
  return yaml.load(fs.readFileSync(filePath).toString())
}

export function getEmbeddedTemplatesDirectory(): string {
  // Embedded templates are located in the templates directory that is in the project/installation root:
  // chectl
  //  |- templates
  //  |- src
  //  |   |- utls.ts
  //  |  ...
  //  |- lib
  //  |   |- util.js
  // ... ...
  // __dirname is
  //   project_root/src if dev mode,
  //   installation_root/lib if run from an installed location
  return path.join(__dirname, '..', '..', 'templates')
}

export function addTrailingSlash(url: string): string {
  if (url.endsWith('/')) {
    return url
  }

  return url + '/'
}

export function getImageNameAndTag(image: string): [string, string] {
  let imageName: string
  let imageTag: string

  if (image.includes('@')) {
    // Image is referenced via a digest
    const index = image.indexOf('@')
    imageName = image.slice(0, Math.max(0, index))
    imageTag = image.slice(Math.max(0, index + 1))
  } else {
    // Image is referenced via a tag
    const lastColonIndex = image.lastIndexOf(':')
    if (lastColonIndex === -1) {
      // Image name without a tag
      imageName = image
      imageTag = 'latest'
    } else {
      const beforeLastColon = image.slice(0, Math.max(0, lastColonIndex))
      const afterLastColon = image.slice(Math.max(0, lastColonIndex + 1))
      if (afterLastColon.includes('/')) {
        // The colon is for registry port and not for a tag
        imageName = image
        imageTag = 'latest'
      } else {
        // The colon separates image name from the tag
        imageName = beforeLastColon
        imageTag = afterLastColon
      }
    }
  }

  return [imageName, imageTag]
}

export function newListr(tasks?: ReadonlyArray<Listr.ListrTask<any>>, collapse = false): Listr {
  const flags = CheCtlContext.getFlags()
  const options = { renderer: (flags[LISTR_RENDERER_FLAG] as any), collapse } as Listr.ListrOptions
  return new Listr(tasks, options)
}

export function isPartOfEclipseChe(resource: any): boolean {
  return resource?.metadata?.labels?.['app.kubernetes.io/part-of'] === 'che.eclipse.org'
}

export function isCheFlavor(): boolean {
  return EclipseChe.CHE_FLAVOR === CHE
}

export async function isCommandExists(commandName: string): Promise<boolean> {
  if (commandExists.sync(commandName)) {
    return true
  }

  // commandExists.sync fails if not executable command exists in the same directory.
  // Double check without accessing local file.
  // The check above there is for backward compatability.

  const whereCommand = os.platform() === 'win32' ? 'where' : 'whereis'
  try {
    await execa(whereCommand, [commandName])
    return true
  } catch {}

  return false
}
