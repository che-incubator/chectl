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

import { ClusterDiscovery } from '../../src/workspace/auth/cluster-discovery';

describe('ClusterDiscovery', () => {
  let discovery: ClusterDiscovery;

  beforeEach(() => {
    discovery = new ClusterDiscovery();
  });

  describe('extractAppsDomain', () => {
    it('extracts apps domain from che URL', () => {
      expect(discovery.extractAppsDomain('https://che.apps.mycluster-01.abc1.p1.openshiftapps.com'))
        .toBe('apps.mycluster-01.abc1.p1.openshiftapps.com');
    });

    it('extracts apps domain from console URL', () => {
      expect(discovery.extractAppsDomain('https://console-openshift-console.apps.mycluster-01.abc1.p1.openshiftapps.com'))
        .toBe('apps.mycluster-01.abc1.p1.openshiftapps.com');
    });

    it('extracts apps domain from API URL', () => {
      expect(discovery.extractAppsDomain('https://api.mycluster-01.abc1.p1.openshiftapps.com:6443'))
        .toBe('apps.mycluster-01.abc1.p1.openshiftapps.com');
    });

    it('handles URL with path and fragment', () => {
      expect(discovery.extractAppsDomain('https://che.apps.cluster.example.com/dashboard/#/workspaces'))
        .toBe('apps.cluster.example.com');
    });

    it('handles direct apps domain', () => {
      expect(discovery.extractAppsDomain('https://apps.cluster.example.com'))
        .toBe('apps.cluster.example.com');
    });

    it('returns undefined for CNAME alias without apps pattern', () => {
      expect(discovery.extractAppsDomain('https://che.mycompany.com'))
        .toBeUndefined();
    });

    it('returns undefined for invalid URL', () => {
      expect(discovery.extractAppsDomain('not-a-url'))
        .toBeUndefined();
    });

    it('handles URL with port in apps pattern', () => {
      expect(discovery.extractAppsDomain('https://che.apps.cluster.example.com:8443'))
        .toBe('apps.cluster.example.com');
    });
  });

  describe('normalizeInputUrl', () => {
    it('adds https:// if missing', () => {
      expect(discovery.normalizeInputUrl('che.apps.cluster.example.com'))
        .toBe('https://che.apps.cluster.example.com');
    });

    it('preserves existing https://', () => {
      expect(discovery.normalizeInputUrl('https://che.apps.cluster.example.com'))
        .toBe('https://che.apps.cluster.example.com');
    });

    it('strips trailing slashes and paths', () => {
      expect(discovery.normalizeInputUrl('https://che.apps.cluster.example.com/dashboard/'))
        .toBe('https://che.apps.cluster.example.com');
    });

    it('trims whitespace', () => {
      expect(discovery.normalizeInputUrl('  https://che.apps.cluster.example.com  '))
        .toBe('https://che.apps.cluster.example.com');
    });

    it('preserves port', () => {
      expect(discovery.normalizeInputUrl('https://api.cluster.example.com:6443'))
        .toBe('https://api.cluster.example.com:6443');
    });
  });

  describe('buildCheUrl', () => {
    it('builds che URL from apps domain', () => {
      expect(discovery.buildCheUrl('https://che.apps.mycluster-01.abc1.p1.openshiftapps.com'))
        .toBe('https://che.apps.mycluster-01.abc1.p1.openshiftapps.com');
    });
  });
});
