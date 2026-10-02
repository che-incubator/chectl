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

import { KubeClientFactory } from '../../src/workspace/kubernetes/kube-client-factory';

// Override the global k8s mock with a functional KubeConfig
jest.mock('@kubernetes/client-node', () => {
  class MockKubeConfig {
    private clusters: any[] = [];
    private users: any[] = [];
    // private contexts: any[] = [];
    private currentCtx = '';

    loadFromOptions(opts: any) {
      this.clusters = opts.clusters;
      this.users = opts.users;
      // this.contexts = opts.contexts;
      this.currentCtx = opts.currentContext;
    }
    getCurrentCluster() { return this.clusters[0]; }
    getCurrentUser() { return this.users[0]; }
    getCurrentContext() { return this.currentCtx; }
  }
  return { KubeConfig: MockKubeConfig, Exec: jest.fn(), V1Status: jest.fn() };
});

describe('KubeClientFactory', () => {
  let factory: KubeClientFactory;

  beforeEach(() => {
    factory = new KubeClientFactory();
  });

  describe('createConfig', () => {
    it('returns a KubeConfig instance', () => {
      const kc = factory.createConfig('https://api.cluster.example.com:6443', 'sha256~token123');
      expect(kc).toBeDefined();
      expect(kc.getCurrentCluster()).toBeDefined();
    });

    it('sets the correct server URL', () => {
      const kc = factory.createConfig('https://api.cluster.example.com:6443', 'sha256~token123');
      const cluster = kc.getCurrentCluster();
      expect(cluster?.server).toBe('https://api.cluster.example.com:6443');
    });

    it('sets the correct bearer token', () => {
      const kc = factory.createConfig('https://api.cluster.example.com:6443', 'sha256~mytoken');
      const user = kc.getCurrentUser();
      expect(user?.token).toBe('sha256~mytoken');
    });

    it('sets current context', () => {
      const kc = factory.createConfig('https://api.cluster.example.com:6443', 'sha256~token');
      expect(kc.getCurrentContext()).toBe('workspace-context');
    });
  });
});
