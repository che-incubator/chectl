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

import {CheCtlContext, InfrastructureContext} from '../../../context'

import { Installer } from '../installer'
import {DevWorkspaceOlmInstaller} from './devworkspace-olm-installer'
import {DevWorkspaceOperatorInstaller} from './devworkspace-operator-installer'

/**
 * Installer factory.
 */
export class DevWorkspaceInstallerFactory {
  public static getInstaller(): Installer {
    const ctx = CheCtlContext.get()
    if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
      return new DevWorkspaceOlmInstaller()
    }

    return new DevWorkspaceOperatorInstaller()
  }
}
