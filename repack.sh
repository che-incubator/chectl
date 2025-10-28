#!/bin/bash
#
# Copyright (c) 2019-2025 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation
#
# Script to repack chectl binaries without the bundled Node.js binary

set -e

# Configuration
DIST_DIR="${DIST_DIR:-dist}"
TEMP_DIR=$(mktemp -d)
REPACKED_DIR="${DIST_DIR}/repacked"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Repack chectl binaries to remove the bundled Node.js binary"
    echo ""
    echo "Options:"
    echo "  -d, --dist-dir DIR    Directory containing the tarballs (default: dist)"
    echo "  -o, --output-dir DIR  Directory for repacked tarballs (default: dist/repacked)"
    echo "  -h, --help            Show this help message"
    echo ""
    exit 0
}

cleanup() {
    echo "[INFO] Cleaning up temporary directory: ${TEMP_DIR}"
    rm -rf "${TEMP_DIR}"
}

# Parse command line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -d|--dist-dir) DIST_DIR="$2"; shift 1;;
        -o|--output-dir) REPACKED_DIR="$2"; shift 1;;
        -h|--help) usage;;
        *) echo "[ERROR] Unknown parameter: $1"; usage;;
    esac
    shift 1
done

# Verify dist directory exists
if [[ ! -d "${DIST_DIR}" ]]; then
    echo "[ERROR] Distribution directory not found: ${DIST_DIR}"
    exit 1
fi

# Create output directory
mkdir -p "${REPACKED_DIR}"

# Set up cleanup on exit
trap cleanup EXIT

echo "[INFO] Starting repack process..."
echo "[INFO] Source directory: ${DIST_DIR}"
echo "[INFO] Output directory: ${REPACKED_DIR}"
echo "[INFO] Temporary directory: ${TEMP_DIR}"

# Find all tar.gz files in dist directory
TARBALLS=($(find "${DIST_DIR}" -maxdepth 1 -name "chectl-*.tar.gz" -type f))

if [[ ${#TARBALLS[@]} -eq 0 ]]; then
    echo "[WARN] No chectl tarballs found in ${DIST_DIR}"
    exit 0
fi

echo "[INFO] Found ${#TARBALLS[@]} tarball(s) to repack"

# Process each tarball
for tarball in "${TARBALLS[@]}"; do
    BASENAME=$(basename "${tarball}")
    echo "[INFO] Processing: ${BASENAME}"

    # Create working directory for this tarball
    WORK_DIR="${TEMP_DIR}/${BASENAME%.tar.gz}"
    mkdir -p "${WORK_DIR}"

    # Extract tarball
    echo "[INFO]   Extracting archive..."
    tar -xzf "${tarball}" -C "${WORK_DIR}"

    # Find and remove node binary (node for Unix, node.exe for Windows)
    NODE_BINARIES=($(find "${WORK_DIR}" -type f \( -name "node" -o -name "node.exe" \) -path "*/bin/*"))

    if [[ ${#NODE_BINARIES[@]} -eq 0 ]]; then
        echo "[ERROR]   No node binary found in ${BASENAME}"
        exit 1
    fi

    for node_bin in "${NODE_BINARIES[@]}"; do
        echo "[INFO]   Removing node binary: ${node_bin#${WORK_DIR}/}"
        rm -f "${node_bin}"
    done

    # Create new tarball
    OUTPUT_FILE="${REPACKED_DIR}/${BASENAME}"
    echo "[INFO]   Creating repacked archive..."

    # Get absolute path for output file
    OUTPUT_FILE_ABS="$(cd "$(dirname "${OUTPUT_FILE}")" && pwd)/$(basename "${OUTPUT_FILE}")"

    # Get the list of extracted directories/files (should be just one root directory)
    EXTRACTED_CONTENTS=($(ls -A "${WORK_DIR}"))

    # Change to work directory and tar using the actual directory names
    (cd "${WORK_DIR}" && tar -czf "${OUTPUT_FILE_ABS}" "${EXTRACTED_CONTENTS[@]}")

    # Calculate SHA256 hash of the repacked tarball
    SHA256=$(sha256sum "${OUTPUT_FILE_ABS}" | awk '{print $1}')
    echo "[INFO]   Calculated SHA256: ${SHA256}"

    # Update the buildmanifest file if it exists
    MANIFEST_FILE="${DIST_DIR}/${BASENAME%.tar.gz}-buildmanifest"
    if [[ -f "${MANIFEST_FILE}" ]]; then
        NEW_MANIFEST="${REPACKED_DIR}/${BASENAME%.tar.gz}-buildmanifest"
        # Update sha256gz field in the manifest
        sed "s/\"sha256gz\": \"[^\"]*\"/\"sha256gz\": \"${SHA256}\"/" "${MANIFEST_FILE}" > "${NEW_MANIFEST}"
        echo "[INFO]   Updated buildmanifest file with new SHA256"
    fi

    # Clean up work directory
    rm -rf "${WORK_DIR}"
done


echo "[INFO] Repack complete!"
