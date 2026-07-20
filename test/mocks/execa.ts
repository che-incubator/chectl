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

export interface ExecaReturnValue {
  stdout: string
  stderr: string
  exitCode: number
  failed: boolean
  command: string
}

export const execa = jest.fn(async (command: string, args?: string[] | any, options?: any): Promise<ExecaReturnValue> => {
  // Default mock implementation
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    failed: false,
    command: `${command} ${Array.isArray(args) ? args.join(' ') : ''}`
  }
})

export default execa
