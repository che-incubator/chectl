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
  if [ $# -ne 3 ]; then
    printf "%bError: %bWrong number of parameters.\nUsage: ./make-release.sh <version> <branch> <fork>\n" "${RED}" "${NC}"
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
  
  VERSION=$1
  BRANCH_NAME=$2
  FORK=$3
  GIT_REMOTE_UPSTREAM="git@github.com:che-incubator/chectl.git"
  GIT_REMOTE_FORK="git@github.com:${FORK}.git"

  git checkout master

  # reset local changes
  while true; do
    read -r -p "It will reset any local changes to the current branch? " yn
    case $yn in
      [Yy]* ) break;;
      [Nn]* ) exit;;
      * ) echo "Please answer yes or no.";;
    esac
  done

  git fetch ${GIT_REMOTE_UPSTREAM}
  if git show-ref -q --heads "release"; then
    git branch -D release
  fi

  # fetch latest changes from master branch
  git pull ${GIT_REMOTE_UPSTREAM} master

  # create a new local and push it to remote branch
  git checkout -b ${BRANCH_NAME} master
  git push ${GIT_REMOTE_UPSTREAM} ${BRANCH_NAME}

  # Create VERSION file
  echo "$VERSION" > VERSION

  # replace nightly versions by release version
  apply_sed "s#quay.io/eclipse/che-server:nightly#quay.io/eclipse/che-server:${VERSION}#g" src/constants.ts
  apply_sed "s#quay.io/eclipse/che-operator:nightly#quay.io/eclipse/che-operator:${VERSION}#g" src/constants.ts

  # now replace package.json dependencies
  apply_sed "s;github.com/eclipse/che#\(.*\)\",;github.com/eclipse/che#${VERSION}\",;g" package.json
  apply_sed "s;github.com/eclipse/che-operator#\(.*\)\",;github.com/eclipse/che-operator#${VERSION}\",;g" package.json

  # add VERSION file to commit
  git add VERSION src package.json yarn.lock

  git commit -a -s -m "chore(release): release version ${VERSION}"

  git push ${GIT_REMOTE_FORK} ${BRANCH_NAME}
}

init "$@"
check "$@"
run "$@"
