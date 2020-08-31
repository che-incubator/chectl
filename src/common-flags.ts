/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { boolean, string } from '@oclif/parser/lib/flags'

import { DOC_LINK_OBTAIN_ACCESS_TOKEN, DOC_LINK_OBTAIN_ACCESS_TOKEN_OAUTH } from './constants'

export const cheNamespace = string({
  char: 'n',
  description: 'Kubernetes namespace where Eclipse Che server is supposed to be deployed',
  default: 'che',
  env: 'CHE_NAMESPACE'
})

export const cheDeployment = string({
  description: 'Eclipse Che deployment name',
  default: 'che',
  env: 'CHE_DEPLOYMENT'
})

export const listrRenderer = string({
  description: 'Listr renderer',
  options: ['default', 'silent', 'verbose'],
  default: 'default'
})

export const accessToken = string({
  description: `Eclipse Che OIDC Access Token. See the documentation how to obtain token: ${DOC_LINK_OBTAIN_ACCESS_TOKEN} and ${DOC_LINK_OBTAIN_ACCESS_TOKEN_OAUTH}.`,
  env: 'CHE_ACCESS_TOKEN'
})

export const skipKubeHealthzCheck = boolean({
  description: 'Skip Kubernetes health check',
  default: false
})
