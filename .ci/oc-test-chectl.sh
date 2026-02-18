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

export CHECTL_REPO=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
source ${CHECTL_REPO}/.ci/oc-common.sh

trap "catchFinish" EXIT SIGINT

runTests() {
  # Yarn install is not able to write in ${CHECTL_REPO}. Work in writable location
  cp -R "${CHECTL_REPO}" /tmp/work
  cd /tmp/work || exit 1

  # Install deps
  yarn install --immutable

  # Run tests using relative path
  yarn test \
    --coverage=false \
    --forceExit \
    --testRegex=test/e2e/e2e.test.ts
}


runTests
