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

import {Flags} from '@oclif/core'
import {EclipseChe} from './tasks/installers/eclipse-che/eclipse-che'
import {CheCtlContext, InfrastructureContext} from './context'

export const PLATFORM_FLAG = 'platform'
export const PLATFORM  = Flags.string({
  char: 'p',
  description: 'Type of Kubernetes platform.',
  options: ['minikube', 'k8s', 'openshift', 'microk8s', 'docker-desktop', 'crc'],
})

export const CHE_NAMESPACE_FLAG = 'chenamespace'
export const CHE_NAMESPACE  = Flags.string({
  char: 'n',
  description: `${EclipseChe.PRODUCT_NAME} Kubernetes namespace.`,
  env: 'CHE_NAMESPACE',
})

export const BATCH_FLAG = 'batch'
export const BATCH = Flags.boolean({
  description: 'Batch mode. Running a command without end user interaction.',
  default: false,
  required: false,
})

export const LISTR_RENDERER_FLAG = 'listr-renderer'
export const LISTR_RENDERER  = Flags.string({
  description: 'Listr renderer',
  options: ['default', 'silent', 'verbose'],
  default: 'default',
  hidden: true,
})

export const SKIP_KUBE_HEALTHZ_CHECK_FLAG = 'skip-kubernetes-health-check'
export const SKIP_KUBE_HEALTHZ_CHECK = Flags.boolean({
  description: 'Skip Kubernetes health check',
  default: false,
})

export const SKIP_CERT_MANAGER_FLAG = 'skip-cert-manager'
export const SKIP_CERT_MANAGER = Flags.boolean({
  default: false,
  description: 'Skip installing Cert Manager (Kubernetes cluster only).',
})

export const SKIP_DEV_WORKSPACE_FLAG = 'skip-devworkspace-operator'
export const SKIP_DEV_WORKSPACE = Flags.boolean({
  default: false,
  description: 'Skip installing Dev Workspace Operator.',
})

export const CHE_OPERATOR_CR_PATCH_YAML_FLAG = 'che-operator-cr-patch-yaml'
export const CHE_OPERATOR_CR_PATCH_YAML  = Flags.string({
  description: 'Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used only when the installer is the \'operator\' or the \'olm\'.',
  default: '',
})

export const ASSUME_YES_FLAG = 'yes'
export const ASSUME_YES = Flags.boolean({
  description: 'Automatic yes to prompts; assume "yes" as answer to all prompts and run non-interactively',
  char: 'y',
  default: false,
  required: false,
  exclusive: [BATCH_FLAG],
})

export const CHE_OPERATOR_CR_YAML_FLAG = 'che-operator-cr-yaml'
export const CHE_OPERATOR_CR_YAML  = Flags.string({
  description: 'Path to a yaml file that defines a CheCluster used by the operator.',
  default: '',
})

export const DEFAULT_POD_WAIT_TIMEOUT = '120000'
export const K8S_POD_WAIT_TIMEOUT_FLAG = 'k8spodwaittimeout'
export const K8S_POD_WAIT_TIMEOUT  = Flags.string({
  description: 'Waiting time for Pod scheduled condition (in milliseconds)',
  default: DEFAULT_POD_WAIT_TIMEOUT,
})

export const DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT = '1200000'
export const K8S_POD_DOWNLOAD_IMAGE_TIMEOUT_FLAG = 'k8spoddownloadimagetimeout'
export const K8S_POD_DOWNLOAD_IMAGE_TIMEOUT  = Flags.string({
  description: 'Waiting time for Pod downloading image (in milliseconds)',
  default: DEFAULT_K8S_POD_DOWNLOAD_IMAGE_TIMEOUT,
})

export const DEFAULT_K8S_POD_READY_TIMEOUT_EMBEDDED_PLUGIN_REGISTRY = '600000'
export const DEFAULT_K8S_POD_READY_TIMEOUT = '120000'
export const K8S_POD_READY_TIMEOUT_FLAG = 'k8spodreadytimeout'
export const K8S_POD_READY_TIMEOUT  = Flags.string({
  description: 'Waiting time for Pod Ready condition (in milliseconds)',
  default: DEFAULT_K8S_POD_READY_TIMEOUT,
})

export const DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT = '60000'
export const K8S_POD_ERROR_RECHECK_TIMEOUT_FLAG = 'k8spoderrorrechecktimeout'
export const K8S_POD_ERROR_RECHECK_TIMEOUT  = Flags.string({
  description: 'Waiting time for Pod rechecking error (in milliseconds)',
  default: DEFAULT_K8S_POD_ERROR_RECHECK_TIMEOUT,
})

export const TEMPLATES_FLAG = 'templates'
export const TEMPLATES  = Flags.string({
  char: 't',
  description: 'Path to the templates folder',
  env: 'CHE_TEMPLATES_FOLDER',
})

export const LOG_DIRECTORY_FLAG = 'directory'
export const LOG_DIRECTORY  = Flags.string({
  char: 'd',
  description: 'Directory to store logs into',
  env: 'CHE_LOGS',
})

export const TELEMETRY_FLAG = 'telemetry'
export const TELEMETRY  = Flags.string({
  description: 'Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry',
  options: ['on', 'off'],
})

export const SKIP_VERSION_CHECK_FLAG = 'skip-version-check'
export const SKIP_VERSION_CHECK = Flags.boolean({
  description: 'Skip minimal versions check.',
  default: false,
})

export const CLUSTER_MONITORING_FLAG = 'cluster-monitoring'
export const CLUSTER_MONITORING = Flags.boolean({
  default: false,
  description: `Enable cluster monitoring to scrape ${EclipseChe.PRODUCT_NAME} metrics in Prometheus.
                    This parameter is used only when the platform is 'openshift'.`,
})

export const CHE_OPERATOR_IMAGE_FLAG = 'che-operator-image'
export const CHE_OPERATOR_IMAGE  = Flags.string({
  description: 'Container image of the operator.',
})

export const CHE_IMAGE_FLAG = 'cheimage'
export const CHE_IMAGE  = Flags.string({
  char: 'i',
  description: `${EclipseChe.PRODUCT_NAME} server container image`,
  env: 'CHE_CONTAINER_IMAGE',
})

export const DOMAIN_FLAG = 'domain'
export const DOMAIN  = Flags.string({
  char: 'b',
  description: `Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)
                    This flag makes sense only for Kubernetes family infrastructures and will be autodetected for Minikube and MicroK8s in most cases.
                    However, for Kubernetes cluster it is required to specify.
                    Please note, that just setting this flag will not likely work out of the box.
                    According changes should be done in Kubernetes cluster configuration as well.
                    In case of Openshift, domain adjustment should be done on the cluster configuration level.`,
  default: '',
})

export const DEBUG_FLAG = 'debug'
export const DEBUG = Flags.boolean({
  description: `'Enables the debug mode for ${EclipseChe.PRODUCT_NAME} server. To debug ${EclipseChe.PRODUCT_NAME} server from localhost use \'server:debug\' command.'`,
  default: false,
})

export const WORKSPACE_PVS_STORAGE_CLASS_NAME_FLAG = 'workspace-pvc-storage-class-name'
export const WORKSPACE_PVS_STORAGE_CLASS_NAME  = Flags.string({
  description: `persistent volume(s) storage class name to use to store ${EclipseChe.PRODUCT_NAME} workspaces data`,
  env: 'CHE_INFRA_KUBERNETES_PVC_STORAGE__CLASS__NAME',
  default: '',
})

export const DEVFILE_REGISTRY_URL_FLAG = 'devfile-registry-url'
export const DEVFILE_REGISTRY_URL  = Flags.string({
  description: 'The URL of the external Devfile registry.',
  env: 'CHE_WORKSPACE_DEVFILE__REGISTRY__URL',
})

export const PLUGIN_REGISTRY_URL_FLAG = 'plugin-registry-url'
export const PLUGIN_REGISTRY_URL  = Flags.string({
  description: 'The URL of the external plugin registry.',
  env: 'CHE_WORKSPACE_PLUGIN__REGISTRY__URL',
})

export const DEBUG_PORT_FLAG = 'debug-port'
export const DEBUG_PORT = Flags.integer({
  description: `${EclipseChe.PRODUCT_NAME} server debug port`,
  default: 8000,
})

export const DELETE_NAMESPACE_FLAG = 'delete-namespace'
export const DELETE_NAMESPACE = Flags.boolean({
  description: `Indicates that a ${EclipseChe.PRODUCT_NAME} namespace will be deleted as well`,
  default: false,
})

export const DELETE_ALL_FLAG = 'delete-all'
export const DELETE_ALL = Flags.boolean({
  description: `Indicates to delete ${EclipseChe.PRODUCT_NAME} and Dev Workspace related resources`,
  default: false,
})

export const DESTINATION_FLAG = 'destination'
export const DESTINATION  = Flags.string({
  char: 'd',
  description: `Destination where to store ${EclipseChe.PRODUCT_NAME} self-signed CA certificate.
                    If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
                    If the destination is a directory, then ${EclipseChe.DEFAULT_CA_CERT_FILE_NAME} file will be created there with ${EclipseChe.PRODUCT_NAME} certificate in PEM format.
                    If this option is omitted, then ${EclipseChe.PRODUCT_NAME} certificate will be stored in a user's temporary directory as ${EclipseChe.DEFAULT_CA_CERT_FILE_NAME}.`,
  env: 'CHE_CA_CERT_LOCATION',
  default: '',
})

export const STARTING_CSV_FLAG = 'starting-csv'
export const STARTING_CSV  = Flags.string({
  description: `Starting cluster service version(CSV) for installation ${EclipseChe.PRODUCT_NAME}.
                    Flags uses to set up start installation version Che.
                    For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
                    Then OLM will install ${EclipseChe.PRODUCT_NAME} with version 7.10.0.
                    Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known version.`,
})

export const AUTO_UPDATE_FLAG = 'auto-update'
export const AUTO_UPDATE = Flags.boolean({
  description: `Auto update approval strategy for installation ${EclipseChe.PRODUCT_NAME}.
                    With this strategy will be provided auto-update ${EclipseChe.PRODUCT_NAME} without any human interaction.
                    By default this flag is enabled.`,
  allowNo: true,
  default: true,
})

export const OLM_CHANNEL_FLAG = 'olm-channel'
export const OLM_CHANNEL  = Flags.string({
  description: `Olm channel to install ${EclipseChe.PRODUCT_NAME}, f.e. stable.
                    If options was not set, will be used default version for package manifest.`,
})

export const PACKAGE_MANIFEST_FLAG = 'package-manifest-name'
export const PACKAGE_MANIFEST  = Flags.string({
  description: `Package manifest name to subscribe to ${EclipseChe.PRODUCT_NAME} OLM package manifest.`,
})

export const CATALOG_SOURCE_NAMESPACE_FLAG = 'catalog-source-namespace'
export const CATALOG_SOURCE_NAME_FLAG = 'catalog-source-name'
export const CATALOG_SOURCE_IMAGE_FLAG = 'catalog-source-image'
export const CATALOG_SOURCE_YAML_FLAG = 'catalog-source-yaml'

export const CATALOG_SOURCE_YAML  = Flags.string({
  description: `Path to a yaml file that describes custom catalog source for installation ${EclipseChe.PRODUCT_NAME} operator.
                    Catalog source will be applied to the namespace with ${EclipseChe.PRODUCT_NAME} operator.
                    Also you need define 'olm-channel' name and 'package-manifest-name'.`,
  dependsOn: [OLM_CHANNEL_FLAG],
  exclusive: [CATALOG_SOURCE_NAME_FLAG, CATALOG_SOURCE_NAMESPACE_FLAG, CATALOG_SOURCE_IMAGE_FLAG],
})

export const CATALOG_SOURCE_NAMESPACE  = Flags.string({
  description: `Namespace for OLM catalog source to install ${EclipseChe.PRODUCT_NAME} operator.`,
  dependsOn: [CATALOG_SOURCE_NAME_FLAG, OLM_CHANNEL_FLAG],
  exclusive: [CATALOG_SOURCE_YAML_FLAG, CATALOG_SOURCE_IMAGE_FLAG],
})

export const CATALOG_SOURCE_NAME = Flags.string({
  description: `Name of the OLM catalog source or index bundle (IIB) from which to install ${EclipseChe.PRODUCT_NAME} operator.`,
  dependsOn: [CATALOG_SOURCE_NAMESPACE_FLAG, OLM_CHANNEL_FLAG],
  exclusive: [CATALOG_SOURCE_YAML_FLAG, CATALOG_SOURCE_IMAGE_FLAG],
})

export const CATALOG_SOURCE_IMAGE = Flags.string({
  description: `OLM catalog source image or index bundle (IIB) from which to install the ${EclipseChe.PRODUCT_NAME} operator.`,
  dependsOn: [OLM_CHANNEL_FLAG],
  exclusive: [CATALOG_SOURCE_YAML_FLAG, CATALOG_SOURCE_NAMESPACE_FLAG, CATALOG_SOURCE_NAME_FLAG],
})

export const INSTALLER_FLAG = 'installer'
export const INSTALLER  = Flags.string({
  char: 'a',
  description: 'Installer type. If not set, default is "olm" for OpenShift 4.x platform otherwise "operator".',
  options: ['operator', 'olm'],
  hidden: true,
})

export function checkFlagsCompatability(flags: any) {
  const ctx = CheCtlContext.get()

  if (ctx[InfrastructureContext.IS_OPENSHIFT]) {
    if (flags[STARTING_CSV_FLAG] && flags[AUTO_UPDATE_FLAG]) {
      throw new Error(`--${STARTING_CSV_FLAG} can be provided with only --no-${AUTO_UPDATE_FLAG}`)
    }

    if (flags[DOMAIN_FLAG]) {
      throw new Error(`--${DOMAIN_FLAG} cannot be provided  for OpenShift platform.`)
    }
  } else {
    // Not OLM installer
    if (flags[STARTING_CSV_FLAG]) {
      throw new Error(`--${STARTING_CSV_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[CATALOG_SOURCE_YAML_FLAG]) {
      throw new Error(`--${CATALOG_SOURCE_YAML_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[OLM_CHANNEL_FLAG]) {
      throw new Error(`--${OLM_CHANNEL_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[PACKAGE_MANIFEST_FLAG]) {
      throw new Error(`--${PACKAGE_MANIFEST_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[CATALOG_SOURCE_NAME_FLAG]) {
      throw new Error(`--${CATALOG_SOURCE_NAME_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[CATALOG_SOURCE_IMAGE_FLAG]) {
      throw new Error(`--${CATALOG_SOURCE_IMAGE_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[CATALOG_SOURCE_NAMESPACE_FLAG]) {
      throw new Error(`--${CATALOG_SOURCE_NAMESPACE_FLAG} can be provided only for OpenShift platform.`)
    }

    if (flags[CLUSTER_MONITORING_FLAG]) {
      throw new Error(`--${CLUSTER_MONITORING_FLAG} can be provided only for OpenShift platform.`)
    }
  }
}
