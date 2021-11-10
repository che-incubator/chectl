#!/bin/bash
#
# Copyright (c) 2012-2021 Red Hat, Inc.
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

# Catch_Finish is executed after finish script.
catchFinish() {
  result=$?
  if [ "$result" != "0" ]; then
    echo "Failed on running tests. Please check logs or contact QE team (e-mail:codereadyqe-workspaces-qe@redhat.com, Slack: #che-qe-internal, Eclipse mattermost: 'Eclipse Che QE'"
    echo "Logs should be availabe on /tmp/artifacts/che-logs"
    getCheClusterLogs
    exit 1
  fi
  exit $result
}

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

# Function to get all logs and events from Che deployments
getCheClusterLogs() {
  mkdir -p ${ARTIFACTS_DIR}/che-logs
  cd ${ARTIFACTS_DIR}/che-logs
  for POD in $(oc get pods -o name -n ${NAMESPACE}); do
    for CONTAINER in $(oc get -n ${NAMESPACE} ${POD} -o jsonpath="{.spec.containers[*].name}"); do
      echo ""
      echo "<=========================Getting logs from $POD==================================>"
      echo ""
      oc logs ${POD} -c ${CONTAINER} -n ${NAMESPACE} | tee $(echo ${POD}-${CONTAINER}.log | sed 's|pod/||g')
    done
  done
  echo "======== oc get events ========"
  oc get events -n ${NAMESPACE}| tee get_events.log
}

run() {
  # Before to start to run the e2e tests we need to install all deps with yarn
  yarn --cwd ${CHECTL_REPO}
  export PLATFORM=openshift
  export INSTALLER=operator
  export XDG_CONFIG_HOME=/tmp/chectl/config
  export XDG_CACHE_HOME=/tmp/chectl/cache
  export XDG_DATA_HOME=/tmp/chectl/data
  echo "[INFO] Running e2e tests on ${PLATFORM} platform."
  yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/e2e.test.ts
}

init
run
