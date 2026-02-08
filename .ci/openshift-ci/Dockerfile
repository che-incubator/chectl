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

# Dockerfile to bootstrap build and test in openshift-ci
FROM registry.access.redhat.com/ubi9/nodejs-22
# hadolint ignore=DL3002
USER 0

# hadolint ignore=DL3041
RUN dnf install -y -q --allowerasing --nobest python3-pip jq \
  openssl openssl-devel ca-certificates make cmake cpp gcc gcc-c++ zlib zlib-devel brotli brotli-devel python3 && \
  pip3 install --upgrade pip && \
  pip3 install yq && \
  dnf clean all && \
  npm install -g corepack && \
  corepack enable && \
  corepack prepare yarn@stable --activate && \
  echo -n "node version: "; node -v; \
  echo -n "npm  version: "; npm -v; \
  echo -n "yarn version: "; yarn -v

# to build chectl in this container, uncomment these lines
# resulting tarball will be in /opt/app-root/src/chectl*.tgz
# COPY . /opt/app-root/src
# RUN yarn && yarn pack && yarn test
