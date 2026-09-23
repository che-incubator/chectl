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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/workspace/WorkspaceModel.ts

import { WorkspacePhase } from '../constants'

/**
 * Data model representing a DevSpaces workspace.
 */
export interface WorkspaceModel {
  /** Workspace name (DevWorkspace metadata.name) */
  name: string
  /** Display name (from kubernetes.io/metadata.name label, falls back to name) */
  displayName: string
  /** Kubernetes namespace */
  namespace: string
  /** Current workspace phase */
  phase: WorkspacePhase
  /** DevWorkspace ID (status.devworkspaceId) */
  devworkspaceId: string
  /** Cluster ID this workspace belongs to */
  clusterId: string
  /** The main URL for browser access (status.mainUrl) */
  mainUrl?: string
  /** Git repository URL from the workspace spec */
  gitRepoUrl?: string
  /** Creation timestamp */
  creationTimestamp?: string
  /** Whether the workspace is requested to be started */
  started: boolean
}
