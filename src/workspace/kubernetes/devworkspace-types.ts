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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/kubernetes/DevWorkspaceTypes.ts

/**
 * Typed response shape for DevWorkspace custom resource API calls.
 *
 * The K8s client returns `object` for custom resources. This interface
 * provides type safety for the fields we actually access, replacing
 * `as any` casts throughout the codebase.
 */
export interface DevWorkspaceResource {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: {
    started?: boolean;
    routingClass?: string;
    template?: {
      components?: DevWorkspaceComponent[];
      commands?: unknown[];
      projects?: Array<{ name: string; git?: { remotes?: { origin: string } } }>;
    };
  };
  status?: {
    phase?: string;
    devworkspaceId?: string;
    mainUrl?: string;
    message?: string;
    conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>;
  };
}

export interface DevWorkspaceComponent {
  name: string;
  container?: {
    image?: string;
    mountSources?: boolean;
    sourceMapping?: string;
  };
}

/**
 * ConsoleLink custom resource (used for Che URL discovery).
 */
export interface ConsoleLinkList {
  items?: Array<{
    metadata?: { name?: string };
    spec?: { href?: string };
  }>;
}

/**
 * OpenShift Project list response (used for namespace discovery).
 */
export interface ProjectList {
  items?: Array<{
    metadata?: {
      name?: string;
      annotations?: Record<string, string>;
    };
  }>;
}
