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

import { CHE_AUTHORITY } from './constants'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'
import macosProtocol from './utils/macosProtocol'

/**
 * Register an OS-level URL handler for the `che://` scheme.
 *
 * Once registered, opening a `che://...` link (for example from the
 * Che dashboard) launches the given command with the URL substituted in,
 * removing the need to copy connection data around by hand.
 *
 * On macOS, we use a custom implementation (macosProtocol) instead of
 * protocol-registry to avoid CWE-78 (OS Command Injection) vulnerabilities.
 * The custom implementation uses AppleScript apps that receive URLs through
 * macOS Launch Services, avoiding shell command interpolation entirely.
 *
 * @param command the command to invoke for a `che://` URL. The literal
 *                `$_URL_` placeholder is substituted with the actual URL.
 *                On macOS, this is handled safely via shell variable assignment.
 * @param force when true, re-register even if a handler already exists (for
 *              example to re-point an existing registration at chectl).
 */
export async function registerUrlHandler(command: string, force = false): Promise<void> {
    // Use custom macOS implementation to avoid shell injection vulnerabilities
    const protoreg = process.platform === 'darwin' ? macosProtocol : require('protocol-registry')

    const appName = `${EclipseChe.PRODUCT_NAME} URL Handler`

    if (!force && await protoreg.checkIfExists(CHE_AUTHORITY)) {
        const appPath = await protoreg.getDefaultApp(CHE_AUTHORITY)
        console.log(`The ${EclipseChe.PRODUCT_NAME} URL handler is already registered at ${appPath}`)
        console.log('Re-run with --force to re-register it against chectl.')
        return
    }

    console.log(`Registering ${EclipseChe.PRODUCT_NAME} URL handler..`)
    await protoreg.register(CHE_AUTHORITY, command, {
        appName,
        terminal: true,
        override: true,
    })
    const appPath = await protoreg.getDefaultApp(CHE_AUTHORITY)
    console.log(`The ${EclipseChe.PRODUCT_NAME} URL handler has been registered at ${appPath}`)
}
