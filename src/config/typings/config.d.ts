/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export interface ChectlConfigs {
    // Segment related configurations
  segment: Segment
}

export interface Segment {
  // Unique ID of chectl. It is created only in case if telemetry it is enabled
  segmentID?: string

  // Indicate if user confirm or not telemetry in chectl
  telemetry?: string
}
