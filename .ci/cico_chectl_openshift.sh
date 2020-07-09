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

init() {
  export SCRIPT=$(readlink -f "$0")
  export SCRIPT_DIR=$(dirname "$SCRIPT")
  export PROFILE=chectl-e2e-tests

  # Environment to define the project absolute path.
  if [[ ${WORKSPACE} ]] && [[ -d ${WORKSPACE} ]]; then
    export CHECTL_REPO=${WORKSPACE};
  else
    export CHECTL_REPO=$(dirname "$SCRIPT_DIR");
  fi
}

run() {
  #Before to start to run the e2e tests we need to install all deps with yarn
  yarn --cwd ${CHECTL_REPO}

  printInfo "Running e2e tests on openshift platform."
  yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/minikube.test.ts
}

init

source ${CHECTL_REPO}/.ci/cico_common.sh
run
