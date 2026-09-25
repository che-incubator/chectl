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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/constants.ts

import { homedir } from 'os'
import * as path from 'path'
import { EclipseChe } from '../tasks/installers/eclipse-che/eclipse-che'

/**
 * Shared constants for the Dev Spaces workspace commands.
 */

/** Local storage path for connection data (keys, kube context, port state). */
export const extStoragePath = path.join(homedir(), `.${EclipseChe.PRODUCT_ID}`)

/** URL scheme handled by the connector (che://...). */
export const CHE_SCHEME = EclipseChe.CHE_FLAVOR

/** DevWorkspace API group and version */
export const DW_API_GROUP = 'workspace.devfile.io'
export const DW_API_VERSION = 'v1alpha2'
export const DW_PLURAL = 'devworkspaces'

/** Workspace phases */
export enum WorkspacePhase {
  Starting = 'Starting',
  Running = 'Running',
  Stopping = 'Stopping',
  Stopped = 'Stopped',
  Failed = 'Failed',
  Failing = 'Failing',
}

/** K8s label keys */
export const LABEL_DEVWORKSPACE_ID = 'controller.devfile.io/devworkspace_id'
export const LABEL_METADATA_NAME = 'kubernetes.io/metadata.name'

/** Sidecar container name prefixes to exclude when finding the main dev container */
export const SIDECAR_PREFIXES = ['che-gateway', 'che-machine-exec', 'che-code', 'che-editor']

/** Timeouts (milliseconds) */
export const OAUTH_CALLBACK_TIMEOUT = 120_000 // 2 minutes for user to complete browser login
export const TOKEN_REFRESH_BUFFER = 300_000 // Refresh 5 minutes before expiry

/** Projects root inside workspace pods */
export const PROJECTS_ROOT = '/projects'
