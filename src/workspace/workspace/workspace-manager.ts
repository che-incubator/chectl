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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/workspace/WorkspaceManager.ts

import { WorkspacePhase } from '../constants'
import { DevWorkspaceApi } from '../kubernetes/devworkspace-api'
import { NamespaceApi } from '../kubernetes/namespace-api'
import { WorkspaceModel } from './workspace-model'

/**
 * High-level workspace lifecycle orchestrator.
 * Coordinates workspace discovery, lifecycle operations, and state management.
 */
export class WorkspaceManager {
  private workspaces: WorkspaceModel[] = []
  private userNamespace: string | undefined

  constructor(
    private devWorkspaceApi: DevWorkspaceApi,
    private namespaceApi: NamespaceApi
  ) {}

  async initialize(username: string): Promise<void> {
    this.userNamespace = await this.namespaceApi.findUserNamespace(username)
    if (!this.userNamespace) {
      console.log(`No namespace found for user ${username}`)
      return
    }
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.userNamespace) {
      return
    }
    try {
      this.workspaces = await this.devWorkspaceApi.list(this.userNamespace)
      console.log(`Loaded ${this.workspaces.length} workspaces`)
    } catch (err) {
      console.log(`Failed to refresh workspaces: ${err}`)
      throw err
    }
  }

  getWorkspaces(): WorkspaceModel[] {
    return [...this.workspaces]
  }

  getNamespace(): string | undefined {
    return this.userNamespace
  }

  async startWorkspace(
    name: string,
  ): Promise<WorkspaceModel> {
    if (!this.userNamespace) {
      throw new Error('User namespace not initialized')
    }
    console.log('Starting workspace...')
    await this.devWorkspaceApi.start(this.userNamespace, name)
    return this.waitForPhase(name, WorkspacePhase.Running)
  }

  async stopWorkspace(name: string): Promise<void> {
    if (!this.userNamespace) {
      throw new Error('User namespace not initialized')
    }
    await this.devWorkspaceApi.stop(this.userNamespace, name)
    await this.refresh()
  }

  async deleteWorkspace(name: string): Promise<void> {
    if (!this.userNamespace) {
      throw new Error('User namespace not initialized')
    }
    await this.devWorkspaceApi.delete(this.userNamespace, name)
    await this.refresh()
  }

  private async waitForPhase(
    name: string,
    targetPhase: WorkspacePhase,
  ): Promise<WorkspaceModel> {
    const timeout = 300
    const deadline = Date.now() + timeout * 1000
    const pollInterval = 3000

    while (Date.now() < deadline) {
      const ws = await this.devWorkspaceApi.get(this.userNamespace!, name)

      console.log(`Workspace is ${ws.phase.toLowerCase()}...`)

      if (ws.phase === targetPhase) {
        await this.refresh()
        return ws
      }

      if (ws.phase === WorkspacePhase.Failed) {
        throw new Error(`Workspace ${name} failed to start`)
      }

      // Update cached workspace so tree shows spinner during transitions
      const idx = this.workspaces.findIndex(w => w.name === name)
      if (idx >= 0) {
        this.workspaces[idx] = ws
      }

      await new Promise(r => setTimeout(r, pollInterval))
    }

    throw new Error(
      `Workspace ${name} did not reach ${targetPhase} within ${timeout}s`
    )
  }
}
