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

/**
 * Suppress the connector's verbose debug logging unless the user asked for it.
 *
 * The ported library uses `console.log` for debug tracing and reserves
 * `console.info` / `console.error` for user-facing output. When not running
 * in verbose mode, silence the debug channel only.
 */
export function configureLogging(verbose: boolean): void {
  if (!verbose) {
    console.log = () => { /* silenced unless --verbose */ }
  }
}
