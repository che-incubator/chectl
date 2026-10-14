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

import { NamespaceApi } from '../../src/workspace/kubernetes/namespace-api';

describe('NamespaceApi', () => {
  let namespaceApi: NamespaceApi;
  let mockCoreApi: any;

  beforeEach(() => {
    mockCoreApi = {
      readNamespace: jest.fn(),
      listNamespace: jest.fn(),
    };
    namespaceApi = new NamespaceApi(mockCoreApi);
  });

  describe('findUserNamespace', () => {
    describe('Strategy 1: Conventional name lookup', () => {
      it('should return conventional name when namespace exists', async () => {
        mockCoreApi.readNamespace.mockResolvedValue({});

        const result = await namespaceApi.findUserNamespace('testuser');

        expect(result).toBe('testuser-che');
        expect(mockCoreApi.readNamespace).toHaveBeenCalledWith({ name: 'testuser-che' });
        expect(mockCoreApi.listNamespace).not.toHaveBeenCalled();
      });
    });

    describe('Strategy 2: Annotation-based discovery', () => {
      beforeEach(() => {
        // Strategy 1 always fails
        mockCoreApi.readNamespace.mockRejectedValue(new Error('Not found'));
      });

      it('should find namespace by annotation when label selector would miss it', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'd9209267-che-heh46u',
                annotations: { 'che.eclipse.org/username': 'D9209267' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('D9209267');

        expect(result).toBe('d9209267-che-heh46u');
      });

      it('should match annotation case-insensitively', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'a9284992-che-05pavn',
                annotations: { 'che.eclipse.org/username': 'A9284992' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('a9284992');

        expect(result).toBe('a9284992-che-05pavn');
      });

      it('should handle uppercase username with lowercase annotation', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'user123-che-abc',
                annotations: { 'che.eclipse.org/username': 'user123' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('USER123');

        expect(result).toBe('user123-che-abc');
      });

      it('should not use label selector (avoids label drift issues)', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({ items: [] });

        await namespaceApi.findUserNamespace('someuser');

        // listNamespace called with NO arguments (no labelSelector)
        expect(mockCoreApi.listNamespace).toHaveBeenCalledWith();
      });

      it('should find namespace among many namespaces', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            { metadata: { name: 'openshift-monitoring', annotations: {} } },
            { metadata: { name: 'default', annotations: undefined } },
            {
              metadata: {
                name: 'd9209267-che-heh46u',
                annotations: {
                  'che.eclipse.org/username': 'D9209267',
                  'openshift.io/requester': 'system:serviceaccount:che-components:che',
                },
                labels: {
                  'blockCode': 'DEFAULT',
                  'example.com/blockCode': 'NON_COMPLAINT',
                },
              },
            },
            {
              metadata: {
                name: 'other-user-che-xyz',
                annotations: { 'che.eclipse.org/username': 'otheruser' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('D9209267');

        expect(result).toBe('d9209267-che-heh46u');
      });

      it('should return undefined when no namespace matches', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'other-che-abc',
                annotations: { 'che.eclipse.org/username': 'otheruser' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('D9209267');

        expect(result).toBeUndefined();
      });

      it('should return undefined when listNamespace fails', async () => {
        mockCoreApi.listNamespace.mockRejectedValue(new Error('Forbidden'));

        const result = await namespaceApi.findUserNamespace('someuser');

        expect(result).toBeUndefined();
      });

      it('should skip namespaces without annotations', async () => {
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            { metadata: { name: 'no-annotations' } },
            { metadata: { name: 'null-annotations', annotations: null } },
            {
              metadata: {
                name: 'target-che-xyz',
                annotations: { 'che.eclipse.org/username': 'targetuser' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('targetuser');

        expect(result).toBe('target-che-xyz');
      });

      it('should handle namespace with random suffix (real-world format)', async () => {
        // Real-world: namespace is lowercase username + random suffix
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'd9209267-che-heh46u',
                annotations: { 'che.eclipse.org/username': 'D9209267' },
              },
            },
          ],
        });

        // Username from oc whoami is uppercase
        const result = await namespaceApi.findUserNamespace('D9209267');

        expect(result).toBe('d9209267-che-heh46u');
      });
    });

    describe('Strategy priority', () => {
      it('should prefer Strategy 1 over Strategy 2 when conventional name exists', async () => {
        mockCoreApi.readNamespace.mockResolvedValue({});
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'testuser-che-xyz',
                annotations: { 'che.eclipse.org/username': 'testuser' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('testuser');

        // Should return conventional name, not the annotated one
        expect(result).toBe('testuser-che');
        expect(mockCoreApi.listNamespace).not.toHaveBeenCalled();
      });

      it('should fall through to Strategy 2 when Strategy 1 fails', async () => {
        mockCoreApi.readNamespace.mockRejectedValue(new Error('Not found'));
        mockCoreApi.listNamespace.mockResolvedValue({
          items: [
            {
              metadata: {
                name: 'user-che-random',
                annotations: { 'che.eclipse.org/username': 'user' },
              },
            },
          ],
        });

        const result = await namespaceApi.findUserNamespace('user');

        expect(result).toBe('user-che-random');
      });
    });
  });
});
