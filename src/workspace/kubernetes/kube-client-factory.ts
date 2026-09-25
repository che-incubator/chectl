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

// https://github.com/redhat-developer/devspaces-remote-connector/blob/main/src/kubernetes/KubeClientFactory.ts

import * as k8s from '@kubernetes/client-node'

/**
 * Stateless factory for creating authenticated Kubernetes API clients.
 * Each call creates a fresh KubeConfig — no shared state between clusters.
 */
export class KubeClientFactory {
  /**
   * Create a KubeConfig authenticated with the given bearer token.
   */
  createConfig(apiUrl: string, token: string): k8s.KubeConfig {
    const kc = new k8s.KubeConfig()

    kc.loadFromOptions({
      clusters: [
        {
          name: 'devspaces-cluster',
          server: apiUrl,
        },
      ],
      users: [
        {
          name: 'devspaces-user',
          token,
        },
      ],
      contexts: [
        {
          name: 'devspaces-context',
          cluster: 'devspaces-cluster',
          user: 'devspaces-user',
        },
      ],
      currentContext: 'devspaces-context',
    })

    console.log(`KubeConfig created for ${apiUrl}`)
    return kc
  }
}
