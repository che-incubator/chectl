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

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGE_JSON="${ROOT}/package.json"
TRACKED_BRANCH="main"

# Optional: TSV file (name, url, oldRef, newRef) used by the workflow to render the pull request body.
CHANGES_FILE=${CHANGES_FILE:-/dev/null}

# @tsv + `read` keeps values containing spaces intact, unlike `for NAME in $(jq ...)`.
while IFS=$'\t' read -r NAME URL REF; do
  # Only commit SHAs are bumped; a tag or branch ref is a deliberate pin and is left as is.
  if [[ ! ${REF} =~ ^[0-9a-f]{40}$ ]]; then
    echo "[INFO] ${NAME} ref '${REF}' is not a commit SHA, skipping"
    continue
  fi

  # `|| true` keeps the check below reachable under `set -euo pipefail`.
  LATEST_REF=$(git ls-remote --exit-code --heads "${URL}" "refs/heads/${TRACKED_BRANCH}" | cut -f1 || true)
  if [[ -z ${LATEST_REF} ]]; then
    echo "[ERROR] Unable to resolve branch '${TRACKED_BRANCH}' of ${URL}"
    exit 1
  fi

  if [[ ${REF} == "${LATEST_REF}" ]]; then
    echo "[INFO] ${NAME} is up to date (${REF})"
    continue
  fi

  echo "[INFO] Updating ${NAME}: ${REF} -> ${LATEST_REF}"
  printf '%s\t%s\t%s\t%s\n' "${NAME}" "${URL}" "${REF}" "${LATEST_REF}" >> "${CHANGES_FILE}"

  jq --arg name "${NAME}" --arg ref "${LATEST_REF}" \
    '(.operatorRepositories[] | select(.name == $name).ref) = $ref' \
    "${PACKAGE_JSON}" > "${PACKAGE_JSON}_"

  mv -f "${PACKAGE_JSON}_" "${PACKAGE_JSON}"
done < <(jq -r '.operatorRepositories[] | [.name, .url, .ref] | @tsv' "${PACKAGE_JSON}")
