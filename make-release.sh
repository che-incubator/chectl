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
  RED='\e[31m'
  NC='\e[0m'
  YELLOW='\e[33m'
  GREEN='\e[32m'

  RELEASE="$1"
  BRANCH=${2:-master}
  GIT_REMOTE_UPSTREAM="git@github.com:che-incubator/chectl.git"
  CURRENT_DIR=$(pwd)
  BASE_DIR=$(cd "$(dirname "$0")"; pwd)
}

check() {
  if [ $# -lt 1 ]; then
    printf "%bError: %bWrong number of parameters.\nUsage: ./make-release.sh <version>\n" "${RED}" "${NC}"
    exit 1
  fi

  echo "Release '$RELEASE' from branch '$BRANCH'"
}

ask() {
  while true; do
    echo -e -n $GREEN$@$NC" (Y)es or (N)o "
    read -r yn
    case $yn in
      [Yy]* ) return 0;;
      [Nn]* ) return 1;;
      * ) echo "Please answer (Y)es or (N)o. ";;
    esac
  done
}

apply_sed() {
    SHORT_UNAME=$(uname -s)
  if [ "$(uname)" == "Darwin" ]; then
    sed -i '' "$1" "$2"
  elif [ "${SHORT_UNAME:0:5}" == "Linux" ]; then
    sed -i "$1" "$2"
  fi
}

resetLocalChanges() {
  set +e
  ask "1. Reset local changes?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    git reset --hard
    git checkout $BRANCH
    git fetch ${GIT_REMOTE_UPSTREAM} --prune
    git pull ${GIT_REMOTE_UPSTREAM} $BRANCH
    git checkout -B $RELEASE
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

release() {
  set +e
  ask "2. Release?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    # Create VERSION file
    echo "$RELEASE" > VERSION

    # replace nightly versions by release version
    apply_sed "s#quay.io/eclipse/che-server:nightly#quay.io/eclipse/che-server:${RELEASE}#g" src/constants.ts
    apply_sed "s#quay.io/eclipse/che-operator:nightly#quay.io/eclipse/che-operator:${RELEASE}#g" src/constants.ts

    # now replace package.json dependencies
    apply_sed "s;github.com/eclipse/che#\(.*\)\",;github.com/eclipse/che#${RELEASE}\",;g" package.json
    apply_sed "s;github.com/eclipse/che-operator#\(.*\)\",;github.com/eclipse/che-operator#${RELEASE}\",;g" package.json

    # build
    yarn
    yarn pack
    yarn test
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

commitChanges() {
  set +e
  ask "3. Commit changes?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    git add -A
    git commit -s -m "chore(release): release version ${RELEASE}"
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

pushChanges() {
  set +e
  ask "4. Push changes?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    git push origin $RELEASE
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

createPR() {
  set +e
  ask "5. Create PR?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    hub pull-request --base ${BRANCH} --head ${RELEASE} --browse -m "Release version ${RELEASE}"
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

pushChangesToReleaseBranch() {
  set +e
  ask "6. Push changes to release branch?"
  result=$?
  set -e

  if [[ $result == 0 ]]; then
    git push origin $RELEASE:release -f
  elif [[ $result == 1 ]]; then
    echo -e $YELLOW"> SKIPPED"$NC
  fi
}

run() {
  resetLocalChanges
  release
  commitChanges
  pushChanges
  createPR
  pushChangesToReleaseBranch
}

init "$@"
check "$@"
run "$@"
