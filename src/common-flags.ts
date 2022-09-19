/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { boolean, string } from '@oclif/parser/lib/flags'

import {
  DEFAULT_CHE_NAMESPACE,
  DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
  DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT,
  DEFAULT_K8S_POD_WAIT_TIMEOUT,
} from './constants'

export const cheNamespace = string({
  char: 'n',
  description: `Eclipse Che Kubernetes namespace. Default to '${DEFAULT_CHE_NAMESPACE}'`,
  env: 'CHE_NAMESPACE',
})

export const batch = boolean({
  description: 'Batch mode. Running a command without end user interaction.',
  default: false,
  required: false,
})

export const listrRenderer = string({
  description: 'Listr renderer',
  options: ['default', 'silent', 'verbose'],
  default: 'default',
  hidden: true,
})

export const skipKubeHealthzCheck = boolean({
  description: 'Skip Kubernetes health check',
  default: false,
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
  exclusive: ['batch'],
})

export const CHE_OPERATOR_CR_YAML_KEY = 'che-operator-cr-yaml'
export const cheOperatorCRYaml = string({
  description: 'Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer is the \'operator\' or the \'olm\'.',
  default: '',
})

export const K8SPODWAITTIMEOUT_KEY = 'k8spodwaittimeout'
export const k8sPodWaitTimeout = string({
  description: 'Waiting time for Pod scheduled condition (in milliseconds)',
  default: `${DEFAULT_K8S_POD_WAIT_TIMEOUT}`,
})

export const K8SPODDOWNLOADIMAGETIMEOUT_KEY = 'k8spoddownloadimagetimeout'
export const k8sPodDownloadImageTimeout = string({
  description: 'Waiting time for Pod downloading image (in milliseconds)',
  default: `${DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT}`,
})

export const K8SPODREADYTIMEOUT_KEY = 'k8spodreadytimeout'
export const k8sPodReadyTimeout = string({
  description: 'Waiting time for Pod Ready condition (in milliseconds)',
  default: `${DEFAULT_K8S_POD_WAIT_TIMEOUT}`,
})

export const K8SPODERRORRECHECKTIMEOUT_KEY = 'k8spoderrorrechecktimeout'
export const k8sPodErrorRecheckTimeout = string({
  description: 'Waiting time for Pod rechecking error (in milliseconds)',
  default: `${DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT}`,
})

export const LOG_DIRECTORY_KEY = 'directory'
export const logsDirectory = string({
  char: 'd',
  description: 'Directory to store logs into',
  env: 'CHE_LOGS',
})

export const CHE_TELEMETRY = string({
  description: 'Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry',
  options: ['on', 'off'],
})

export const DEPLOY_VERSION_KEY = 'version'
export const cheDeployVersion = string({
  char: 'v',
  description: 'Version to deploy (e.g. 7.15.2). Defaults to the same as chectl.',
  env: 'CHE_DEPLOY_VERSION',
  hidden: true,
})
