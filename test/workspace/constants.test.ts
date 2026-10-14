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

import { CHE_AUTHORITY } from '../../src/workspace/constants';

describe('Constants', () => {
  describe('CHE_AUTHORITY', () => {
    it('should be defined', () => {
      expect(CHE_AUTHORITY).toBeDefined();
    });

    it('should be a string', () => {
      expect(typeof CHE_AUTHORITY).toBe('string');
    });

    it('should be che', () => {
      expect(CHE_AUTHORITY).toBe('che');
    });

    it('should not contain special characters that would conflict with remote authority syntax', () => {
      // Remote authority format is: scheme://authority+name/path
      // So the authority should not contain + or / or ://
      expect(CHE_AUTHORITY).not.toContain('+');
      expect(CHE_AUTHORITY).not.toContain('/');
      expect(CHE_AUTHORITY).not.toContain('://');
    });

    it('should be lowercase for consistency with VS Code conventions', () => {
      expect(CHE_AUTHORITY).toBe(CHE_AUTHORITY.toLowerCase());
    });

    it('should use a clean identifier format', () => {
      expect(CHE_AUTHORITY).not.toContain('_');
    });

    it('should clearly indicate it is for Che', () => {
      expect(CHE_AUTHORITY.toLowerCase()).toContain('che');
    });

    it('should avoid conflicts with other remote extensions', () => {
      // Should not be 'ssh-remote' which is used by Open Remote SSH
      expect(CHE_AUTHORITY).not.toBe('ssh-remote');
      expect(CHE_AUTHORITY).not.toContain('ssh');
    });
  });
});
