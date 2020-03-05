#!/bin/bash
#
# Copyright (c) 2012-2020 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

set -e -x

#Stop execution on any error
trap "fail_trap" EXIT

init() {
  SCRIPT=$(readlink -f "$0")
  SCRIPTPATH=$(dirname "$SCRIPT")
  PROFILE=chectl-e2e-tests

  # Environment to define the project absolute path.
  if [[ ${WORKSPACE} ]] && [[ -d ${WORKSPACE} ]]; then
    CHECTL_REPO=${WORKSPACE};
  else
    CHECTL_REPO=$(dirname "$SCRIPTPATH");
  fi

  #Create tmp path for binaries installations.
  if [ ! -d "$CHECTL_REPO/tmp" ]; then mkdir -p "$CHECTL_REPO/tmp" && chmod 777 "$CHECTL_REPO/tmp"; fi
}

# fail_trap is executed if an error occurs.
fail_trap() {
  result=$?
  if [ "$result" != "0" ]; then
    printError "Please check CI fail.Cleaning up minikube and minishift..."
  fi
  cleanup
  exit $result
}

# cleanup temporary files or minikube/minishift installations.
cleanup() {
  set +e
  yes | minishift delete --profile ${PROFILE}
  minikube delete --profile ${PROFILE}
  rm -rf ~/.minishift ~/.kube ~/.minikube
}

#Call all necesaries dependencies to install
install_utilities() {
  helm_install
  install_required_packages
  setup_kvm_machine_driver
  install_node_deps
  installStartDocker
}

run() {
  #Before to start to run the e2e tests we need to install all deps with yarn
  yarn --cwd ${CHECTL_REPO}
  for platform in 'minikube'
  do
      if [[ ${platform} == 'aaminishift' ]]; then
        minishift_installation

        printInfo "Running e2e tests on ${platform} platform."
        yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/minishift.test.ts
        yes | minishift delete --profile ${PROFILE}
        rm -rf ~/.minishift
      fi
      if [[ ${platform} == 'minikube' ]]; then
        minikube_installation

        sleep 60
        printInfo "Running e2e tests on ${platform} platform."
        yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/minikube.test.ts
      fi
  done
}

init

source ${CHECTL_REPO}/.ci/cico_common.sh
install_utilities
minikube_installation
yarn --cwd ${CHECTL_REPO}
sleep 480
yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/minikube.test.ts
