#
# Copyright (c) 2019 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
FROM ruby:2.6-alpine
COPY Gemfile /tmp/
RUN apk add --no-cache --virtual build-dependencies build-base \
    && cd /tmp && bundle install \
    && apk del build-dependencies build-base \
    && apk add libstdc++ \
    && mkdir /projects \
    && for f in "/projects"; do \
           chgrp -R 0 ${f} && \
           chmod -R g+rwX ${f}; \
       done
WORKDIR /projects
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
