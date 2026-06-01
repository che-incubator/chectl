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

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

> "$SCRIPT_DIR/REVISIONS"
for name in $(jq -r '.operatorRepositories[].name' "$SCRIPT_DIR/package.json"); do
  url=$(jq -r --arg n "$name" '.operatorRepositories[] | select(.name == $n).url' "$SCRIPT_DIR/package.json")
  ref=$(jq -r --arg n "$name" '.operatorRepositories[] | select(.name == $n).ref' "$SCRIPT_DIR/package.json")
  sha=$(git -C "$SCRIPT_DIR/.operator-sources/$name" rev-parse HEAD)
  printf '%s\t%s\t%s\t%s\n' "$name" "$url" "$ref" "$sha" >> "$SCRIPT_DIR/REVISIONS"
done
echo "[INFO] Wrote REVISIONS"
