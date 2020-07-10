# Dockerfile to bootstrap build and test in openshift-ci

FROM registry.svc.ci.openshift.org/openshift/release:golang-1.12

RUN curl -sL https://rpm.nodesource.com/setup_10.x | bash - && \
  yum-config-manager --add-repo https://dl.yarnpkg.com/rpm/yarn.repo && \
  yum install -y nodejs yarn
