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

FROM registry.ci.openshift.org/openshift/release:golang-1.18

RUN curl -sL https://rpm.nodesource.com/setup_18.x | bash - && \
  yum-config-manager --add-repo https://dl.yarnpkg.com/rpm/yarn.repo && \
  yum install -y yarn
