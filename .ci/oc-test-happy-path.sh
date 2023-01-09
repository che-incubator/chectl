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

set -ex

export DEVWORKSPACE_HAPPY_PATH="https://raw.githubusercontent.com/eclipse/che/main/tests/devworkspace-happy-path"
export CHECTL_REPO=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
source ${CHECTL_REPO}/.ci/oc-common.sh

trap "catchFinish" EXIT SIGINT

runTests() {
  cat >/tmp/eclipse-che-catalog-source.yaml <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: eclipse-che
  namespace: openshift-marketplace
  labels:
    app.kubernetes.io/part-of: che.eclipse.org
spec:
  sourceType: grpc
  publisher: Eclipse Che
  displayName: Eclipse Che
  image: quay.io/eclipse/eclipse-che-olm-catalog:stable
EOF

  yarn --cwd ${CHECTL_REPO}
  bin/run server:deploy \
    --platform openshift \
    --olm-channel stable \
    --package-manifest-name eclipse-che \
    --catalog-source-yaml /tmp/eclipse-che-catalog-source.yaml \
    --telemetry off \
    --batch

  export HAPPY_PATH_SUITE=test-empty-workspace-devworkspace-happy-path-code
  bash <(curl -s ${DEVWORKSPACE_HAPPY_PATH}/remote-launch.sh)
}

runTests
