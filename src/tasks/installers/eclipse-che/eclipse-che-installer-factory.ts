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

import {CheCtlContext, InfrastructureContext} from '../../../context'

import { EclipseCheOlmInstaller } from './eclipse-che-olm-installer'
import { EclipseCheOperatorInstaller } from './eclipse-che-operator-installer'
import { Installer } from '../installer'

/**
 * Installer factory.
 */
export class EclipseCheInstallerFactory {
  public static getInstaller(): Installer {
    const ctx = CheCtlContext.get()
    if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
      return new EclipseCheOlmInstaller()
    }

    return new EclipseCheOperatorInstaller()
  }
}
