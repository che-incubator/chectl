/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { string } from '@oclif/parser/lib/flags'

export const cheNamespace = string({
  char: 'n',
  description: 'Kubernetes namespace where Che server is supposed to be deployed',
  default: 'che',
  env: 'CHE_NAMESPACE'
})

export const cheDeployment = string({
  description: 'Che deployment name',
  default: 'che',
  env: 'CHE_DEPLOYMENT'
})

export const listrRenderer = string({
  description: 'Listr renderer',
  options: ['default', 'silent', 'verbose'],
  default: 'default'
})

export const accessToken = string({
  description: 'Che OIDC Access Token',
  env: 'CHE_ACCESS_TOKEN'
})
