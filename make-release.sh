#!/bin/bash
#
# Copyright (c) 2019 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

set -e
set -u

init() {
  RED='\033[0;31m'
  NC='\033[0m'
}

check() {
  if [ $# -eq 0 ]; then
    printf "%bError: %bNo version provided. Command is $ make-release.sh <version>\n" "${RED}" "${NC}"
    exit 1
  fi
}

apply_sed() {
    SHORT_UNAME=$(uname -s)
  if [ "$(uname)" == "Darwin" ]; then
    sed -i '' "$1" "$2"
  elif [ "${SHORT_UNAME:0:5}" == "Linux" ]; then
    sed -i "$1" "$2"
  fi
}

run() {
  # use master branch
  git checkout master

  # reset local changes
  while true; do
    read -r -p "It will reset any local changes to the current branch ?" yn
    case $yn in
      [Yy]* ) break;;
      [Nn]* ) exit;;
      * ) echo "Please answer yes or no.";;
    esac
  done

  git fetch
  if git show-ref -q --heads "release"; then
    git branch -D release
  fi

  VERSION=$1

  # Create VERSION file
  echo "$VERSION" > VERSION

  # replace nightly versions by release version
  apply_sed "s#eclipse/che-server:nightly#eclipse/che-server:${VERSION}#g" src/commands/server/constants.ts
  apply_sed "s#quay.io/eclipse/che-operator:nightly#quay.io/eclipse/che-operator:${VERSION}#g" src/commands/server/constants.ts


  # now replace package.json dependencies
  apply_sed "s;github.com/eclipse/che#\(.*\)\",;github.com/eclipse/che#${VERSION}\",;g" package.json
  apply_sed "s;github.com/eclipse/che-operator#\(.*\)\",;github.com/eclipse/che-operator#${VERSION}\",;g" package.json

  # move into the release branch
  git checkout -b release

  # add VERSION file to commit
  git add VERSION src package.json yarn.lock
}

init "$@"
check "$@"
run "$@"
