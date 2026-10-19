#!/bin/bash
#
# Copyright (c) 2019-2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation
#

# Updates the `ref` of each package.json `operatorRepositories` entry to the latest
# commit of the `main` branch. Only refs pinned to a commit SHA are updated,
# refs pinned to a tag (release branches) are left untouched.
#
# Usage: ./hack/update-operator-refs.sh [<summary-file>]
#   <summary-file>  optional file to write a Markdown summary of the updates to

set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGE_JSON="${ROOT}/package.json"
BRANCH="main"
SUMMARY_FILE="$1"

[[ -n ${SUMMARY_FILE} ]] && : > "${SUMMARY_FILE}"

for NAME in $(jq -r '.operatorRepositories[].name' "${PACKAGE_JSON}"); do
  URL=$(jq -r --arg name "${NAME}" '.operatorRepositories[] | select(.name == $name).url' "${PACKAGE_JSON}")
  CURRENT_REF=$(jq -r --arg name "${NAME}" '.operatorRepositories[] | select(.name == $name).ref' "${PACKAGE_JSON}")

  if [[ ! ${CURRENT_REF} =~ ^[0-9a-f]{40}$ ]]; then
    echo "[INFO] ${NAME} ref is not a commit SHA (${CURRENT_REF}), skipping"
    continue
  fi

  LATEST_REF=$(git ls-remote --exit-code "${URL}" "refs/heads/${BRANCH}" | cut -f1)
  if [[ -z ${LATEST_REF} ]]; then
    echo "[ERROR] Unable to resolve ${BRANCH} branch of ${URL}"
    exit 1
  fi

  if [[ ${CURRENT_REF} == "${LATEST_REF}" ]]; then
    echo "[INFO] ${NAME} is up to date (${CURRENT_REF})"
    continue
  fi

  echo "[INFO] Updating ${NAME}: ${CURRENT_REF} -> ${LATEST_REF}"
  jq --arg name "${NAME}" --arg ref "${LATEST_REF}" \
    '(.operatorRepositories[] | select(.name == $name).ref) = $ref' \
    "${PACKAGE_JSON}" > "${PACKAGE_JSON}_"
  mv -f "${PACKAGE_JSON}_" "${PACKAGE_JSON}"

  if [[ -n ${SUMMARY_FILE} ]]; then
    echo "- \`${NAME}\`: ${URL%.git}/compare/${CURRENT_REF}...${LATEST_REF}" >> "${SUMMARY_FILE}"
  fi
done
