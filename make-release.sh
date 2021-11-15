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
{   echo "Usage: ./make-release.sh -v <version>"
    exit
}

if [[ $# -lt 1 ]]; then usage; fi

while [[ "$#" -gt 0 ]]; do
  case $1 in
    '-v'|'--version') VERSION="$2"; shift 1;;
    '--help'|'-h') usage;;
  esac
  shift 1
done

init() {
  BRANCH=$(echo $VERSION | sed 's/.$/x/')
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
  git fetch origin --prune
  git pull origin $1
}

checkoutToReleaseBranch() {
  echo "[INFO] Checking out to $BRANCH branch."
  local branchExist=$(git ls-remote -q --heads | grep $BRANCH | wc -l)
  if [[ $branchExist == 1 ]]; then
    echo "[INFO] $BRANCH exists."
    resetChanges $BRANCH
  else
    echo "[INFO] $BRANCH does not exist. Will be created a new one from main."
    resetChanges main
    git push origin main:$BRANCH
  fi
  git checkout -B $VERSION
}

release() {
  echo "[INFO] Releasing a new $VERSION version"

  # Create VERSION file
  echo "$VERSION" > VERSION

  # now replace package.json dependencies
  apply_sed "s;github.com/eclipse-che/che-operator#\(.*\)\",;github.com/eclipse-che/che-operator#${VERSION}\",;g" package.json
  apply_sed "s;\"@eclipse-che/api\": \"\(.*\)\",;\"@eclipse-che/api\": \"${VERSION}\",;g" package.json

  if ! grep -q "github.com/eclipse-che/che-operator#${VERSION}" package.json; then
    echo "[ERROR] Unable to find Che Operator version ${VERSION} in the package.json"; exit 1
  fi

  # build
  yarn
  yarn pack
  yarn test
}

commitChanges() {
  echo "[INFO] Pushing changes to $VERSION branch"
  git add -A
  git commit -s -m "chore(release): release version ${VERSION}"
  git push origin $VERSION
}

createReleaseBranch() {
  echo "[INFO] Create the release branch based on $VERSION"
  git push origin $VERSION:release -f
}

createPR() {
  echo "[INFO] Creating a PR"
  hub pull-request --base ${BRANCH} --head ${VERSION} -m "Release version ${VERSION}"
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
