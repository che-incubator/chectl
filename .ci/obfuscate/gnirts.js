'use strict'
/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

const gnirts = require('gnirts');
const fs = require('fs')

const rootDir = process.cwd()

const obfuscateJSFiles = () => {
  const dirFilesToObfuscate = [ 'lib/hooks/analytics/analytics.js' ]
 
  dirFilesToObfuscate.forEach((jsFilePath)=> {
    if (fs.existsSync(`${rootDir}/${jsFilePath}`)) {
      let js = fs.readFileSync(`${rootDir}/${jsFilePath}`, {encoding: 'utf8'});
      js = gnirts.mangle(js);
      fs.writeFileSync(`${rootDir}/${jsFilePath}`, js);
    }
  })
}

obfuscateJSFiles()
