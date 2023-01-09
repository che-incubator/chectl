#!/bin/bash
#
# Copyright (c) 2019-2021 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation
#

set -e -x

# Stop execution on any error
trap "catchFinish" EXIT SIGINT


# Setup all necessary environments needed by e2e and Openshift CI
init() {
  export SCRIPT=$(readlink -f "$0")
  export SCRIPT_DIR=$(dirname "$SCRIPT")

  # Env necessary for openshift CI to put che logs inside
  export ARTIFACTS_DIR="/tmp/artifacts"

  # SUGGESTED NAMESPACE
  export NAMESPACE="eclipse-che"

  # Environment to define the project absolute path.
  if [[ ${WORKSPACE} ]] && [[ -d ${WORKSPACE} ]]; then
    export CHECTL_REPO=${WORKSPACE};
  else
    export CHECTL_REPO=$(dirname "$SCRIPT_DIR");
  fi
}

run() {
  # Before to start to run the e2e tests we need to install all deps with yarn
  yarn --cwd ${CHECTL_REPO}
  export PLATFORM=openshift
  export INSTALLER=olm
  export XDG_CONFIG_HOME=/tmp/chectl/config
  export XDG_CACHE_HOME=/tmp/chectl/cache
  export XDG_DATA_HOME=/tmp/chectl/data
  echo "[INFO] Running e2e tests on ${PLATFORM} platform."
  yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/e2e.test.ts
}

init
run
