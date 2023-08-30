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
FROM registry.access.redhat.com/ubi9/nodejs-18:1
# hadolint ignore=DL3002
USER 0

# hadolint ignore=DL3041
RUN dnf install -y -q --allowerasing --nobest nodejs-devel nodejs-libs \
  # already installed or installed as deps:
  openssl openssl-devel ca-certificates make cmake cpp gcc gcc-c++ zlib zlib-devel brotli brotli-devel python3 nodejs-packaging && \
  dnf update -y && dnf clean all && \
  npm install -g yarn@1.22 npm@9 && \
  echo -n "node version: "; node -v; \
  echo -n "npm  version: "; npm -v; \
  echo -n "yarn version: "; yarn -v

# to build chectl in this container, uncomment these lines
# resulting tarball will be in /opt/app-root/src/chectl*.tgz
# COPY . /opt/app-root/src
# RUN yarn && yarn pack && yarn test
