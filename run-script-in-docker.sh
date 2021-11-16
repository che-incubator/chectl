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

# git ROOT directory used to mount filesystem
GIT_ROOT_DIRECTORY=$(git rev-parse --show-toplevel)

# Container image
IMAGE_NAME="che-incubator/chectl-docker-run"

init() {
  BLUE='\033[1;34m'
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  NC='\033[0m'
  BOLD='\033[1m'
}

check() {
  if [ $# -eq 0 ]; then
    printf "%bError: %bNo script provided. Command is $ run-script-in-docker.sh <script-to-run> [optional-arguments-of-script-to-run]\n" "${RED}" "${NC}"
    exit 1
  fi
  echo "check $1"
  if [ ! -f "$1" ]; then
    printf "%bError: %bscript %b provided is not existing. Command is $ run-script-in-docker.sh <script-to-run> [optional-arguments-of-script-to-run]\n" "${RED}" "${NC}" "${1}"
    exit 1
  fi
}

# Build image
build() {
  printf "%bBuilding image %b${IMAGE_NAME}${NC}..." "${BOLD}" "${BLUE}"
  if docker build -t ${IMAGE_NAME} > docker-build-log 2>&1 -<<EOF
  FROM alpine:3.10
  RUN apk add --no-cache git bash
  WORKDIR /workdir
EOF
then
  printf "%b[OK]%b\n" "${GREEN}" "${NC}"
  rm docker-build-log
else
  printf "%bFailure%b\n" "${RED}" "${NC}"
  cat docker-build-log
  exit 1
fi
}


run() {
  printf "%bRunning%b $*\n" "${BOLD}" "${NC}"
  if docker run --rm -it -v "${GIT_ROOT_DIRECTORY}":/workdir --entrypoint=/bin/bash ${IMAGE_NAME} "$@"
  then
    printf "Script execution %b[OK]%b\n" "${GREEN}" "${NC}"
  else
    printf "%bFail to run the script%b\n" "${RED}" "${NC}"
    exit 1
  fi
}

init "$@"
check "$@"
build "$@"
run "$@"
