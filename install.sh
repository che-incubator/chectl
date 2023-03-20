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
#   Florent Benoit - Initial Implementation

# export all functions
set -a
set -e
set -u

CURRENT_DIR=$(pwd)
INSTALL_LOG_FILE="${CURRENT_DIR}/chectl-install.log"

init_constants() {
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  NC='\033[0m'
}

log() {
  echo "$@" >> "${INSTALL_LOG_FILE}"
}

error() {
  printf "${RED}ERROR:${NC} %s\n" "${1}" >&2
  log "$(printf "ERROR: %s\n" "${1}")"
  exit 1
}

command_exists() {
  command -v "$@" > /dev/null 2>&1
}

grab_silent_command() {
  if command_exists curl; then
    echo "curl -fsSL"
  elif command_exists wget; then
    echo "wget -qO-"
  else
    error "curl or wget are missing"
    return 1
  fi
}

grab_progress_command() {
  if command_exists curl; then
    # Use -# for percentage progress
    echo "curl -#fSL"
  elif command_exists wget; then
    # only wget 1.16 has the progress...
    wget --help | grep -q '\--show-progress' && PROGRESS_OPT="-q --show-progress" || PROGRESS_OPT="-q"
    echo "wget ${PROGRESS_OPT} -O-"
  else
    error "curl or wget are missing"
    return 1
  fi
}

get_operating_system() {
  SHORT_UNAME=$(uname -s)
  if [ "$(uname)" == "Darwin" ]; then
    echo "darwin"
  elif [ "${SHORT_UNAME:0:5}" == "Linux" ]; then
    echo "linux"
  else
    error "This installer is only supported on Linux and macOS. Found $(uname)"
    return 1
  fi
}

get_arch() {
  if [ "$(uname -m)" == "x86_64" ]; then
    echo "x64"
  elif [[ "$(uname -m)" == arm* ]]; then
    if [ "$(uname)" == "Darwin" ]; then
      echo "arm64"
    else
      echo "arm"
    fi
  else
    error "unsupported arch: $(uname -m)"
    return 1
  fi
}

get_channel() {
  DEFAULT_CHANNEL="stable"
  CHANNEL=${CHANNEL:-${DEFAULT_CHANNEL}}

  if [ ! "${CHANNEL}" == "stable" ]  && [ ! "${CHANNEL}" == "next" ]; then
    error "unsupported channel: Only stable and next are supported. Found '${CHANNEL}'"
    return 1
  fi
  echo "${CHANNEL}"
}

get_remove_other_versions() {
  DEFAULT_OTHER_VERSIONS="false"
  DELETE_OTHER_VERSIONS=${DELETE_OTHER_VERSIONS:-${DEFAULT_OTHER_VERSIONS}}
  echo "${DELETE_OTHER_VERSIONS}"
}

check_requirements() {
  get_operating_system > /dev/null
  get_arch > /dev/null
  get_channel > /dev/null
  grab_silent_command > /dev/null
}

compute_download_link() {

  OS=$(get_operating_system)
  ARCH=$(get_arch)
  CHANNEL=$(get_channel)
  echo "https://che-incubator.github.io/chectl/download-link/${CHANNEL}-${OS}-${ARCH}"
}

grab_download_link() {
  DOWNLOAD_LINK=$(compute_download_link)
  DOWNLOAD_COMMAND=$(grab_silent_command)
 log "${DOWNLOAD_COMMAND} ${DOWNLOAD_LINK}"
  if OUTPUT=$(${DOWNLOAD_COMMAND} "${DOWNLOAD_LINK}") ; then
    echo "${OUTPUT}"
  else
    return 1
  fi
}

check_bin_path() {
  if [[ ! ":${PATH}:" == *":/usr/local/bin:"* ]]; then
    error "Your path is missing /usr/local/bin, you need to add this to use this installer."
  fi
}

cleanup_previous_install() {
  log "mkdir -p /usr/local/lib"
  mkdir -p /usr/local/lib
  log "cd /usr/local/lib"
  cd /usr/local/lib
  log "rm -rf chectl"
  rm -rf chectl
  log "rm -rf ~/.local/share/chectl/client"
  rm -rf ~/.local/share/chectl/client
}

check_another_install() {
  # if chectl is already available on the path
  if CHECTL_IN_THE_PATH=$(which chectl) ; then
    # Check it's in usr/local/bin
    if [[ ! ":${CHECTL_IN_THE_PATH}:" == *":/usr/local/bin/chectl:"* ]]; then
      DELETE=$(get_remove_other_versions)
      if [[ "${DELETE}" == "true" ]]; then
        if rm ${CHECTL_IN_THE_PATH} ; then
          log "Removing previous install chectl from ${CHECTL_IN_THE_PATH}"
        else
          error "Flag to remove other installs of chectl enabled but there was an error while removing ${CHECTL_IN_THE_PATH}"
        fi
      else
        error "chectl found in PATH installed at ${CHECTL_IN_THE_PATH} but it's not where this script will install it (/usr/local/bin/chectl). Please remove it first or use --delete-other-versions flag"
      fi
    fi
  fi
}

chectl_install() {
  # check path is OK
  check_bin_path

  # Check there is no other chectl installed in another directory
  check_another_install

  # Cleanup
  cleanup_previous_install

  # Do we have a final link ?
  if ! REDIRECT_LINK=$(grab_download_link) ; then
    error "No download link found at $(compute_download_link)"
    return 1
  fi

  # Check if not empty
  if [ -z "${REDIRECT_LINK}" ]; then
    error "Missing redirect link from the download link $(compute_download_link). Content found is '${REDIRECT_LINK}''"
    return 1
  fi

  # let's download and unpack
  echo "Downloading ${REDIRECT_LINK}..."
  DOWNLOAD_COMMAND=$(grab_progress_command)
  log "${DOWNLOAD_COMMAND} ${REDIRECT_LINK} | tar xz"
  if ! OUTPUT=$(${DOWNLOAD_COMMAND} "${REDIRECT_LINK}" | tar xz) ; then
    error "Unable to download chectl binary from ${REDIRECT_LINK}"
    return 1
  fi

  # now, install bin
  # delete old chectl bin if exists
  log "rm -f $(command -v chectl) || true"
  rm -f "$(command -v chectl)" || true
  log "rm -f /usr/local/bin/chectl"
  rm -f /usr/local/bin/chectl
  log "ln -s /usr/local/lib/chectl/bin/chectl /usr/local/bin/chectl"
  ln -s /usr/local/lib/chectl/bin/chectl /usr/local/bin/chectl

  # on alpine (and maybe others) the basic node binary does not work
  # remove our node binary and fall back to whatever node is on the PATH
  log "/usr/local/lib/chectl/bin/node -v > /dev/null 2>&1 || rm /usr/local/lib/chectl/bin/node"
  /usr/local/lib/chectl/bin/node -v > /dev/null 2>&1 || rm /usr/local/lib/chectl/bin/node
}

while [ $# -gt 0 ]; do
  case $1 in
    --channel=*)
      CHANNEL="${1#*=}"
      shift ;;
    --delete-other-versions)
      DELETE_OTHER_VERSIONS=true
      shift ;;
    --*)
      printf "${RED}Unknown parameter: %s${NC}\n" "$1"; exit 2 ;;
    *)
      shift;;
  esac
done

SUDO=''

# init constants
init_constants

# Check requirements
check_requirements

if [ "$(id -u)" != "0" ]; then
  echo "chectl script requires superuser access."
  echo "You will be prompted for your password by sudo."
  SUDO='sudo env PATH=$PATH'
  # clear any previous sudo permission
  sudo -k
fi

# kind of hack to use all our functions with sudo
IFS=$'\n'
PRE_DEFINED=()
COUNTER=0
for f in $(declare -F); do
  if [[ ${f} == "declare -fx"* ]];then
    PRE_DEFINED[${COUNTER}]="${f:12}"
    COUNTER=$((COUNTER+1))
  fi
done
FUNC=$(declare -f "${PRE_DEFINED[@]}")
${SUDO} bash -c "${FUNC}; CURRENT_DIR=$(pwd) INSTALL_LOG_FILE=\"${CURRENT_DIR}/chectl-install.log\" CHANNEL=\"${CHANNEL}\" chectl_install"

# test the CLI
if command_exists chectl; then
  LOCATION=$(command -v chectl)
  printf "${GREEN}SUCCESS:${NC} chectl installed to ${BOLD}%s${NC}\n" "${LOCATION}"
  printf "${GREEN}SUCCESS:${NC} installation log written in ${BOLD}%s${NC}\n" "${INSTALL_LOG_FILE}"
  chectl version
else
  error "failure during installation, chectl command is not available in the PATH"
fi

