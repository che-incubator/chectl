/**
 * Copyright (c) 2019-2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

'use strict'

const fs = require('fs-extra')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = __dirname
const SOURCES = path.join(ROOT, '.operator-sources')
const NODE_MODULES = path.join(ROOT, 'node_modules')

// Clone operator repos (no package.json; Yarn 4 cannot install them as git deps).
// Copies into node_modules so prepare-templates.js can run unchanged.
function main () {
  // Read repository metadata from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const repos = packageJson.operatorRepositories

  if (!repos || !Array.isArray(repos)) {
    throw new Error('operatorRepositories not found or invalid in package.json')
  }

  fs.ensureDirSync(SOURCES)
  for (const repo of repos) {
    const dest = path.join(SOURCES, repo.name)
    if (!fs.existsSync(path.join(dest, '.git'))) {
      console.log(`Cloning ${repo.name}...`)
      execSync(`git clone --depth 1 --branch ${repo.ref} ${repo.url} "${dest}"`, {
        stdio: 'inherit',
        cwd: ROOT
      })
    } else {
      execSync(`git fetch --depth 1 origin ${repo.ref} && git checkout FETCH_HEAD`, {
        stdio: 'inherit',
        cwd: dest
      })
    }
    const nodeModulesDest = path.join(NODE_MODULES, repo.name)
    fs.ensureDirSync(path.dirname(nodeModulesDest))
    fs.copySync(dest, nodeModulesDest, { overwrite: true })
  }
}

main()
