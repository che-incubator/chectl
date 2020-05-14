/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export interface OAuth {
    apiVersion: string;
    kind: string;
    metadata: V1ObjectMeta;
  
    spec: OAuthSpec;
}

export interface OAuthSpec {
    identityProviders: IdentityProvider[];
}

export interface IdentityProvider {
    name: string;
    type: string;
}
