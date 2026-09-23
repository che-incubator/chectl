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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/kubernetes/DevWorkspaceApi.ts

import * as k8s from '@kubernetes/client-node'
import { DW_API_GROUP, DW_API_VERSION, DW_PLURAL, LABEL_METADATA_NAME, WorkspacePhase } from '../constants'
import { WorkspaceModel } from '../workspace/workspace-model'

/** Content-type required for RFC 6902 JSON Patch requests. */
const JSON_PATCH_HEADERS = { headers: { 'content-type': 'application/json-patch+json' } }

/**
 * Wraps the Kubernetes CustomObjectsApi for DevWorkspace CRD operations.
 * Handles listing, getting, starting, stopping, and deleting workspaces.
 *
 * Workspace *creation* is handled by the DevSpaces dashboard (browser flow),
 * not by this class.
 */
export class DevWorkspaceApi {
  /** Validate a K8s resource name (RFC 1123 DNS subdomain). */
  private validateName(name: string): void {
    if (!/^[a-z0-9]([a-z0-9\-]{0,251}[a-z0-9])?$/.test(name)) {
      throw new Error(`Invalid resource name: ${name.slice(0, 60)}`)
    }
  }

  /** Validate a K8s namespace name. */
  private validateNamespace(ns: string): void {
    if (!/^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$/.test(ns)) {
      throw new Error(`Invalid namespace: ${ns.slice(0, 60)}`)
    }
  }

  constructor(private customApi: k8s.CustomObjectsApi, private clusterId: string) {}

  async list(namespace: string): Promise<WorkspaceModel[]> {
    this.validateNamespace(namespace)
    console.log(`Listing DevWorkspaces in ${namespace}`)
    const { body } = await this.customApi.listNamespacedCustomObject(
      DW_API_GROUP, DW_API_VERSION, namespace, DW_PLURAL
    )
    const response = body as { items: DevWorkspaceResource[] }
    return response.items.map(item => this.toModel(item, namespace))
  }

  async get(namespace: string, name: string): Promise<WorkspaceModel> {
    this.validateNamespace(namespace)
    this.validateName(name)
    const { body } = await this.customApi.getNamespacedCustomObject(
      DW_API_GROUP, DW_API_VERSION, namespace, DW_PLURAL, name
    )
    return this.toModel(body as DevWorkspaceResource, namespace)
  }

  async start(namespace: string, name: string): Promise<void> {
    this.validateNamespace(namespace)
    this.validateName(name)
    console.log(`Starting workspace ${name} in ${namespace}`)
    await this.customApi.patchNamespacedCustomObject(
      DW_API_GROUP, DW_API_VERSION, namespace, DW_PLURAL, name,
      [{ op: 'replace', path: '/spec/started', value: true }],
      undefined, undefined, undefined, JSON_PATCH_HEADERS
    )
  }

  async stop(namespace: string, name: string): Promise<void> {
    this.validateNamespace(namespace)
    this.validateName(name)
    console.log(`Stopping workspace ${name} in ${namespace}`)
    await this.customApi.patchNamespacedCustomObject(
      DW_API_GROUP, DW_API_VERSION, namespace, DW_PLURAL, name,
      [{ op: 'replace', path: '/spec/started', value: false }],
      undefined, undefined, undefined, JSON_PATCH_HEADERS
    )
  }

  async delete(namespace: string, name: string): Promise<void> {
    this.validateNamespace(namespace)
    this.validateName(name)
    console.log(`Deleting workspace ${name} in ${namespace}`)
    await this.customApi.deleteNamespacedCustomObject(
      DW_API_GROUP, DW_API_VERSION, namespace, DW_PLURAL, name
    )
  }

  private toModel(resource: DevWorkspaceResource, namespace: string): WorkspaceModel {
    const status = resource.status ?? {}
    const spec = resource.spec ?? {}
    let gitRepoUrl: string | undefined
    const projects = spec.template?.projects ?? []
    if (projects.length > 0 && projects[0]?.git?.remotes?.origin) {
      gitRepoUrl = projects[0].git.remotes.origin
    }
    return {
      name: resource.metadata?.name ?? 'unknown',
      displayName: resource.metadata?.labels?.[LABEL_METADATA_NAME] ?? resource.metadata?.name ?? 'unknown',
      namespace,
      phase: (status.phase as WorkspacePhase) ?? WorkspacePhase.Stopped,
      devworkspaceId: status.devworkspaceId ?? resource.metadata?.uid ?? '',
      clusterId: this.clusterId,
      mainUrl: status.mainUrl,
      gitRepoUrl,
      creationTimestamp: resource.metadata?.creationTimestamp,
      started: spec.started ?? false,
    }
  }
}

interface DevWorkspaceResource {
  apiVersion?: string;
  kind?: string;
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
      components?: Array<{ name: string; container?: { image?: string; mountSources?: boolean; sourceMapping?: string } }>;
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
