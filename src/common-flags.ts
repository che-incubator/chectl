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

import { DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE, DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT, DEFAULT_K8S_POD_WAIT_TIMEOUT, DOC_LINK_OBTAIN_ACCESS_TOKEN, DOC_LINK_OBTAIN_ACCESS_TOKEN_OAUTH } from './constants'

export const cheNamespace = string({
  char: 'n',
  description: 'Kubernetes namespace where Eclipse Che server is supposed to be deployed',
  default: 'che',
  env: 'CHE_NAMESPACE'
})

export const devWorkspaceControllerNamespace = string({
  description: 'Namespace for the DevWorkspace controller.  This parameter is used only when the workspace engine is the DevWorkspace',
  default: DEFAULT_DEV_WORKSPACE_CONTROLLER_NAMESPACE,
  env: 'DEV_WORKSPACE_OPERATOR_NAMESPACE',
})

export const cheDeployment = string({
  description: 'Eclipse Che deployment name',
  default: 'che',
  env: 'CHE_DEPLOYMENT'
})

export const listrRenderer = string({
  description: 'Listr renderer',
  options: ['default', 'silent', 'verbose'],
  default: 'default',
  hidden: true,
})

export const ACCESS_TOKEN_KEY = 'access-token'
export const accessToken = string({
  description: `Eclipse Che OIDC Access Token. See the documentation how to obtain token: ${DOC_LINK_OBTAIN_ACCESS_TOKEN} and ${DOC_LINK_OBTAIN_ACCESS_TOKEN_OAUTH}.`,
  env: 'CHE_ACCESS_TOKEN'
})

export const skipKubeHealthzCheck = boolean({
  description: 'Skip Kubernetes health check',
  default: false
})

export const CHE_API_ENDPOINT_KEY = 'che-api-endpoint'
export const cheApiEndpoint = string({
  description: 'Eclipse Che server API endpoint',
  env: 'CHE_API_ENDPOINT',
  required: false,
})

export const CHE_OPERATOR_CR_PATCH_YAML_KEY = 'che-operator-cr-patch-yaml'
export const cheOperatorCRPatchYaml = string({
  description: 'Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used only when the installer is the \'operator\' or the \'olm\'.',
  default: '',
})

export const assumeYes = boolean({
  description: 'Automatic yes to prompts; assume "yes" as answer to all prompts and run non-interactively',
  char: 'y',
  default: false,
  required: false,
})

export const CHE_OPERATOR_CR_YAML_KEY = 'che-operator-cr-yaml'
export const cheOperatorCRYaml = string({
  description: 'Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer is the \'operator\' or the \'olm\'.',
  default: ''
})

export const USERNAME_KEY = 'username'
export const username = string({
  char: 'u',
  description: 'Eclipse Che username',
  env: 'CHE_USER_NAME',
  required: false,
})

export const K8SPODWAITTIMEOUT_KEY = 'k8spodwaittimeout'
export const k8sPodWaitTimeout = string({
  description: 'Waiting time for Pod scheduled condition (in milliseconds)',
  default: `${DEFAULT_K8S_POD_WAIT_TIMEOUT}`
})

export const K8SPODDOWNLOADIMAGETIMEOUT_KEY = 'k8spoddownloadimagetimeout'
export const k8sPodDownloadImageTimeout = string({
  description: 'Waiting time for Pod downloading image (in milliseconds)',
  default: `${DEFAULT_K8S_POD_WAIT_TIMEOUT}`
})

export const K8SPODREADYTIMEOUT_KEY = 'k8spodreadytimeout'
export const k8sPodReadyTimeout = string({
  description: 'Waiting time for Pod Ready condition (in milliseconds)',
  default: `${DEFAULT_K8S_POD_WAIT_TIMEOUT}`
})

export const K8SPODERRORRECHECKTIMEOUT_KEY = 'k8spoderrorrechecktimeout'
export const k8sPodErrorRecheckTimeout = string({
  description: 'Waiting time for Pod rechecking error (in milliseconds)',
  default: `${DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT}`
})

export const LOG_DIRECTORY_KEY = 'directory'
export const logsDirectory = string({
  char: 'd',
  description: 'Directory to store logs into',
  env: 'CHE_LOGS'
})
