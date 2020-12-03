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

usage ()
{   echo "Usage: ./make-release.sh <version>"
    exit
}

if [[ $# -lt 1 ]]; then usage; fi

while [[ "$#" -gt 0 ]]; do
  case $1 in
    '--release') RELEASE="$1"; shift 1;;
    *) RELEASE="$1"; shift 0;;
    '--help'|'-h') usage;;
  esac
  shift 1
done

init() {
  BRANCH=$(echo $RELEASE | sed 's/.$/x/')
  GIT_REMOTE_UPSTREAM="git@github.com:che-incubator/chectl.git"
}

apply_sed() {
    SHORT_UNAME=$(uname -s)
  if [ "$(uname)" == "Darwin" ]; then
    sed -i '' "$1" "$2"
  elif [ "${SHORT_UNAME:0:5}" == "Linux" ]; then
    sed -i "$1" "$2"
  fi
}

resetChanges() {
  echo "[INFO] Reset changes in $1 branch"
  git reset --hard
  git checkout $1
  git fetch ${GIT_REMOTE_UPSTREAM} --prune
  git pull ${GIT_REMOTE_UPSTREAM} $1
}

checkoutToReleaseBranch() {
  echo "[INFO] Checking out to $BRANCH branch."
  local branchExist=$(git ls-remote -q --heads | grep $BRANCH | wc -l)
  if [[ $branchExist == 1 ]]; then
    echo "[INFO] $BRANCH exists."
    resetChanges $BRANCH
  else
    echo "[INFO] $BRANCH does not exist. Will be created a new one from master."
    resetChanges master
    git push origin master:$BRANCH
  fi
  git checkout -B $RELEASE
}

release() {
  echo "[INFO] Releasing a new $RELEASE version"

  # Create VERSION file
  echo "$RELEASE" > VERSION

  # Get DevWorkspace operator latest commit
  SHA1_DEV_WORKSPACE_OPERATOR=$(git ls-remote https://github.com/devfile/devworkspace-operator HEAD | cut -f1)
  SHORT_SHA1_DEV_WORKSPACE_OPERATOR=$(echo ${SHA1_DEV_WORKSPACE_OPERATOR} | cut -c1-7)

  # replace nightly versions by release version
  apply_sed "s#quay.io/eclipse/che-server:.*#quay.io/eclipse/che-server:${RELEASE}'#g" src/constants.ts
  apply_sed "s#quay.io/eclipse/che-operator:.*#quay.io/eclipse/che-operator:${RELEASE}'#g" src/constants.ts
  apply_sed "s#quay.io/devfile/devworkspace-controller:.*#quay.io/devfile/devworkspace-controller:sha-${SHORT_SHA1_DEV_WORKSPACE_OPERATOR}'#g" src/constants.ts

  # now replace package.json dependencies
  apply_sed "s;github.com/eclipse/che#\(.*\)\",;github.com/eclipse/che#${RELEASE}\",;g" package.json
  apply_sed "s;github.com/eclipse/che-operator#\(.*\)\",;github.com/eclipse/che-operator#${RELEASE}\",;g" package.json
  apply_sed "s;git://github.com/devfile/devworkspace-operator#\(.*\)\",;git://github.com/devfile/devworkspace-operator#${SHA1_DEV_WORKSPACE_OPERATOR}\",;g" package.json

  # build
  yarn
  yarn pack
  yarn test
}

commitChanges() {
  echo "[INFO] Pushing changes to $RELEASE branch"
  git add -A
  git commit -s -m "chore(release): release version ${RELEASE}"
  git push origin $RELEASE
}

createReleaseBranch() {
  echo "[INFO] Create the release branch based on $RELEASE"
  git push origin $RELEASE:release -f
}

createPR() {
  echo "[INFO] Creating a PR"
  hub pull-request --base ${BRANCH} --head ${RELEASE} --browse -m "Release version ${RELEASE}"
}

run() {
  checkoutToReleaseBranch
  release
  commitChanges
  createReleaseBranch
  createPR
}

init
run
