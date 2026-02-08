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

set -e

usage ()
{   echo "Usage: ./make-release.sh -v <version> -d <devworkspace-operator-version>"
    exit
}

if [[ $# -lt 1 ]]; then usage; fi

while [[ "$#" -gt 0 ]]; do
  case $1 in
    '-v'|'--version') VERSION="$2"; shift 1;;
    '-d'|'--devworkspace-operator-version') DWO_VERSION="$2"; shift 1;;
    '--help'|'-h') usage;;
  esac
  shift 1
done

init() {
  [[ -z ${VERSION} ]] && { echo "[ERROR] Release version is not defined"; usage; }
  [[ -z ${DWO_VERSION} ]] && discoverLatestDevWorkspaceOperatorVersion
  BRANCH=$(echo $VERSION | sed 's/.$/x/')
  git config pull.rebase true
}

discoverLatestDevWorkspaceOperatorVersion() {
 git clone https://github.com/devfile/devworkspace-operator /tmp/dwo
 pushd /tmp/dwo
     DWO_VERSION=$(git describe --tags $(git rev-list --tags --max-count=1))
 popd
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
  createBranch=$1
  echo "[INFO] Check out to $BRANCH branch"
  local branchExist=$(git ls-remote -q --heads | grep $BRANCH | wc -l)
  if [[ $branchExist == 1 ]]; then
    echo "[INFO] Branch $BRANCH exists"
    resetChanges $BRANCH
  else
    if [[ $createBranch == "true" ]]; then
      echo "[INFO] Branch $BRANCH does not exist"
      resetChanges main
      git push origin main:$BRANCH
      echo "[INFO] Created new branch $BRANCH from main"
    else
      echo "[WARN] Branch $BRANCH does not exist. Use 'checkoutToReleaseBranch true' to create it"
    fi

  fi
  git checkout -B $VERSION
}

release() {
  echo "[INFO] Release a new $VERSION version"
  echo "[INFO] Dev Workspace Operator version $DWO_VERSION"

  # Create VERSION file
  echo "$VERSION" > VERSION

  # now replace package.json operatorRepositories refs
  jq --arg version "$VERSION" \
     --arg dwo_version "$DWO_VERSION" \
     '
     (.operatorRepositories[] | select(.name == "eclipse-che-operator").ref) = $version |
     (.operatorRepositories[] | select(.name == "devworkspace-operator").ref) = $dwo_version |
     .version = $version
     ' package.json > package.json_
  mv -f package.json_ package.json

  # Validate changes
  CHE_REF=$(jq -r '.operatorRepositories[] | select(.name == "eclipse-che-operator").ref' package.json)
  DWO_REF=$(jq -r '.operatorRepositories[] | select(.name == "devworkspace-operator").ref' package.json)

  if [[ "$CHE_REF" != "$VERSION" ]]; then
    echo "[ERROR] Unable to update Che Operator ref to ${VERSION} in package.json (found: $CHE_REF)"; exit 1
  fi

  if [[ "$DWO_REF" != "$DWO_VERSION" ]]; then
    echo "[ERROR] Unable to update Dev Workspace Operator ref to ${DWO_VERSION} in package.json (found: $DWO_REF)"; exit 1
  fi

  # build
  corepack enable
  yarn --immutable
  yarn pack
  yarn test
}

commitChanges() {
  echo "[INFO] Push changes to $VERSION branch"
  git add -A
  git commit -s -m "chore(release): release version ${VERSION}"
  git pull origin $VERSION | true
  git push origin $VERSION
}

createReleaseBranch() {
  echo "[INFO] Create the release branch based on $VERSION"
  git push origin $VERSION:release -f
}

createPR() {
  checkoutToReleaseBranch true
  echo "[INFO] Create PR with base = ${BRANCH} and head = ${VERSION}"
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
