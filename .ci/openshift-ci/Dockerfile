# Dockerfile to bootstrap build and test in openshift-ci

FROM registry.ci.openshift.org/openshift/release:golang-1.13

RUN curl -sL https://rpm.nodesource.com/setup_12.x | bash - && \
  yum-config-manager --add-repo https://dl.yarnpkg.com/rpm/yarn.repo && \
  yum install -y nodejs yarn
