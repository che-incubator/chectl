#!/bin/bash
#
# Copyright (c) 2019-2023 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation
#

export NAMESPACE="eclipse-che"
export ARTIFACTS_DIR="/tmp/artifacts"
export PLATFORM=openshift
export XDG_CONFIG_HOME=/tmp/chectl/config
export XDG_CACHE_HOME=/tmp/chectl/cache
export XDG_DATA_HOME=/tmp/chectl/data

catchFinish() {
  result=$?
  if [ "$result" != "0" ]; then
    set +x
    collectEclipseCheLogs
    set -x
  fi

  exit $result
}

collectEclipseCheLogs() {
  mkdir -p ${ARTIFACTS_DIR}/che-logs
  ${CHECTL_REPO}/bin/run server:logs --directory ${ARTIFACTS_DIR}/che-logs --telemetry off
}
