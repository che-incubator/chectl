/*********************************************************************
 * Copyright (c) 2019-2021 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

'use strict'

const gnirts = require('gnirts');
const fs = require('fs')
const path = require('path')

const rootDir = process.cwd()

const obfuscateJSFiles = () => {
  const jsFilesToObfuscate = [ 'lib/hooks/analytics/analytics.js' ]
 
  jsFilesToObfuscate.forEach((jsFilePath)=> {
    const fileToObfuscate = path.join(rootDir, jsFilePath)
    if (fs.existsSync(fileToObfuscate)) {
      let js = fs.readFileSync(fileToObfuscate, {encoding: 'utf8'});
      js = gnirts.mangle(js);
      fs.writeFileSync(fileToObfuscate, js);
    }
  })
}

obfuscateJSFiles()
