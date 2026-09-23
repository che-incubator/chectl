/**
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import protoreg = require('protocol-registry')
import { DEVSPACES_SCHEME } from './constants'

/**
 * Register an OS-level URL handler for the `devspaces://` scheme.
 *
 * Once registered, opening a `devspaces://...` link (for example from the
 * Dev Spaces dashboard) launches the given command with the URL substituted in,
 * removing the need to copy connection data around by hand.
 *
 * @param command the command to invoke for a `devspaces://` URL. The literal
 *                `$_URL_` placeholder is replaced by protocol-registry with the
 *                actual URL at invocation time.
 * @param force when true, re-register even if a handler already exists (for
 *              example to re-point an existing registration at chectl).
 */
export async function registerDevspacesHandler(command: string, force = false): Promise<void> {
    const appName = 'Dev Spaces URL Handler'

    if (!force && await protoreg.checkIfExists(DEVSPACES_SCHEME)) {
        const appPath = await protoreg.getDefaultApp(DEVSPACES_SCHEME)
        console.log(`The Dev Spaces URL handler is already registered at ${appPath}`)
        console.log('Re-run with --force to re-register it against chectl.')
        return
    }

    console.log('Registering Dev Spaces URL handler..')
    await protoreg.register(DEVSPACES_SCHEME, command, {
        appName,
        terminal: true,
        override: true,
    })
    const appPath = await protoreg.getDefaultApp(DEVSPACES_SCHEME)
    console.log(`The Dev Spaces URL handler has been registered at ${appPath}`)
}
