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

import { loadSystemCAs, getHttpsAgent } from '../../src/workspace/utils/tls';

// Mock child_process to avoid actually running security commands
jest.mock('child_process', () => ({
  execFileSync: jest.fn().mockReturnValue(''),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  writeFileSync: jest.fn(),
  promises: { readFile: jest.fn() },
}));

describe('tls', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_EXTRA_CA_CERTS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadSystemCAs', () => {
    it('does not throw when system CA export fails', () => {
      const { execFileSync } = require('child_process');
      execFileSync.mockImplementation(() => { throw new Error('command not found'); });
      expect(() => loadSystemCAs()).not.toThrow();
    });

    it('reads NODE_EXTRA_CA_CERTS file when env var is set', () => {
      const fs = require('fs');
      process.env.NODE_EXTRA_CA_CERTS = '/tmp/test-ca.pem';
      fs.readFileSync.mockReturnValue('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----');
      expect(() => loadSystemCAs()).not.toThrow();
    });
  });

  describe('getHttpsAgent', () => {
    it('returns an https.Agent instance', () => {
      const agent = getHttpsAgent();
      expect(agent).toBeDefined();
      expect(agent.options).toBeDefined();
    });

    it('includes bundled CA certificates in agent options', () => {
      loadSystemCAs();
      const agent = getHttpsAgent();
      const ca = agent.options.ca as (string | Buffer)[];
      expect(ca).toBeDefined();
      // Should include Node's built-in root certs at minimum
      expect(ca.length).toBeGreaterThan(0);
    });
  });
});
