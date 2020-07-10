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
  SCRIPT_DIR=$(dirname "$SCRIPT")
  PROFILE=chectl-e2e-tests

  # Environment to define the project absolute path.
  if [[ ${WORKSPACE} ]] && [[ -d ${WORKSPACE} ]]; then
    CHECTL_REPO=${WORKSPACE};
  else
    CHECTL_REPO=$(dirname "$SCRIPT_DIR");
  fi

  #Create tmp path for binaries installations.
  if [ ! -d "$CHECTL_REPO/tmp" ]; then mkdir -p "$CHECTL_REPO/tmp" && chmod 777 "$CHECTL_REPO/tmp"; fi
}

# fail_trap is executed if an error occurs.
fail_trap() {
  result=$?
  if [ "$result" != "0" ]; then
    printError "Please check CI fail.Cleaning up minikube and minishift..."
    getCheClusterLogs
  fi
  cleanup
  exit $result
}

# cleanup temporary files or minikube/minishift installations.
cleanup() {
  set +e
  minikube delete && yes | kubeadm reset
  rm -rf ~/.kube ~/.minikube
}

#Call all necesaries dependencies to install from {PROJECT_PATH/.ci/ci.common.sh}
install_utilities() {
  installJQ
  load_jenkins_vars
  setup_kvm_machine_driver
  install_node_deps
  installStartDocker
}

# Function to get all logs and events from Che deployments
getCheClusterLogs() {
  mkdir -p /root/payload/report/che-logs
  cd /root/payload/report/che-logs
  for POD in $(kubectl get pods -o name -n ${NAMESPACE}); do
    for CONTAINER in $(kubectl get -n ${NAMESPACE} ${POD} -o jsonpath="{.spec.containers[*].name}"); do
      echo ""
      echo "<=========================Getting logs from $POD==================================>"
      echo ""
      kubectl logs ${POD} -c ${CONTAINER} -n ${NAMESPACE} | tee $(echo ${POD}-${CONTAINER}.log | sed 's|pod/||g')
    done
  done
  echo "======== oc get events ========"
  kubectl get events -n ${NAMESPACE}| tee get_events.log
}

run() {
  #Before to start to run the e2e tests we need to install all deps with yarn
  yarn --cwd ${CHECTL_REPO}

  source ${CHECTL_REPO}/.ci/start-minikube.sh

  sleep 60
  printInfo "Running e2e tests on minikube platform."
  yarn test --coverage=false --forceExit --testRegex=${CHECTL_REPO}/test/e2e/minikube.test.ts
}

init

source ${CHECTL_REPO}/.ci/cico_common.sh
install_utilities
run
