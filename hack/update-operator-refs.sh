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

# Optional: TSV file (name, url, oldRef, newRef) used by the workflow to render the pull request body.
CHANGES_FILE=${CHANGES_FILE:-/dev/null}

UPDATED=0

# @tsv + `read` keeps values containing spaces intact, unlike `for NAME in $(jq ...)`.
while IFS=$'\t' read -r NAME URL REF BRANCH; do
  # Only repositories with an explicitly tracked branch are updated. Repositories pinned to a
  # release tag (see make-release.sh) have no 'branch', so their ref is left untouched.
  if [[ -z ${BRANCH} ]]; then
    echo "[INFO] ${NAME}: ref '${REF}' is not tracked (no 'branch' in package.json); skipping"
    continue
  fi

  # `|| true` keeps the check below reachable under `set -euo pipefail`.
  LATEST_REF=$(git ls-remote --exit-code "${URL}" "refs/heads/${BRANCH}" | cut -f1 || true)
  if [[ -z ${LATEST_REF} ]]; then
    echo "[ERROR] Unable to resolve branch '${BRANCH}' of ${URL}"
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
  UPDATED=$((UPDATED + 1))
done < <(jq -r '.operatorRepositories[] | [.name, .url, .ref, (.branch // "")] | @tsv' "${PACKAGE_JSON}")

echo "[INFO] Updated ${UPDATED} ref(s)"
