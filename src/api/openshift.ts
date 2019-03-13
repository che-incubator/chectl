/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import execa = require('execa')

export class OpenShiftHelper {
  async getHostByRouteName(routeName: string, namespace = ''): Promise<string> {
    const command = 'oc'
    const args = ['get', 'route', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${routeName}')]}{.spec.host}{end}`]
    const { stdout } = await execa(command, args, { timeout: 10000 })
    return stdout.trim()
  }
}
