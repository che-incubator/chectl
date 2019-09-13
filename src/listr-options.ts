/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as Listr from 'listr'

export namespace ListrOptions {
  /**
   * Returns ListrOptions for tasks rendering.
   *
   * @param listRenderer listRenderer that should be used
   */
  export function getTasksListrOptions(listRenderer: any): Listr.ListrOptions {
    return {
      renderer: listRenderer as any,
      collapse: false,
      showSubtasks: true
    }
  }
}
