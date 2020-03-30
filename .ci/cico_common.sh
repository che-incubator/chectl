#!/bin/bash
#
# Copyright (c) 2012-2020 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

RAM_MEMORY=8192
MSFT_RELEASE="1.34.2"

printInfo() {
  set +x
  echo ""
  echo "[=============== [INFO] $1 ===============]"
}

printWarn() {
  set +x
  echo ""
  echo "[=============== [WARN] $1 ===============]"
}

printError() {
  set +x
  echo ""
  echo "[=============== [ERROR] $1 ===============]"
}


helm_install() {
  curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash
}

installEpelRelease() {
  # Install EPEL repo
  if yum repolist | grep epel; then
    printInfo "Epel already installed, skipping instalation."
  else
    #excluding mirror1.ci.centos.org
    printInfo "Installing epel..."
    yum install -d1 --assumeyes epel-release
    yum update --assumeyes -d1
  fi
}

installStartDocker() {
  if [ -x "$(command -v docker)" ]; then
    printWarn "Docker already installed"
  else
    printInfo "Installing docker..."
    yum install --assumeyes -d1 yum-utils device-mapper-persistent-data lvm2
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    printInfo "Starting docker service..."
    yum install --assumeyes -d1 docker-ce
    systemctl start docker
    docker version
  fi
}

install_node_deps() {
  curl -sL https://rpm.nodesource.com/setup_10.x | bash -
  yum-config-manager --add-repo https://dl.yarnpkg.com/rpm/yarn.repo
  yum install -y nodejs yarn git
}

setup_kvm_machine_driver() {
  echo "======== Start to install KVM virtual machine ========"

  yum install -y qemu-kvm libvirt libvirt-python libguestfs-tools virt-install

  curl -L https://github.com/dhiltgen/docker-machine-kvm/releases/download/v0.10.0/docker-machine-driver-kvm-centos7 -o /usr/local/bin/docker-machine-driver-kvm
  chmod +x /usr/local/bin/docker-machine-driver-kvm

  systemctl enable libvirtd
  systemctl start libvirtd

  virsh net-list --all
  echo "======== KVM has been installed successfully ========"
}

github_token_set() {
  #Setup GitHub token for minishift
  if [ -z "$CHE_BOT_GITHUB_TOKEN" ]
  then
    printWarn "\$CHE_BOT_GITHUB_TOKEN is empty. Minishift start might fail with GitGub API rate limit reached."
  else
    printInfo "\$CHE_BOT_GITHUB_TOKEN is set, checking limits."
    GITHUB_RATE_REMAINING=$(curl -slL "https://api.github.com/rate_limit?access_token=$CHE_BOT_GITHUB_TOKEN" | jq .rate.remaining)
    if [ "$GITHUB_RATE_REMAINING" -gt 1000 ]
    then
      printInfo "Github rate greater than 1000. Using che-bot token for minishift startup."
      export MINISHIFT_GITHUB_API_TOKEN=$CHE_BOT_GITHUB_TOKEN
    else
      printInfo "Github rate is lower than 1000. *Not* using che-bot for minishift startup."
      printInfo "If minishift startup fails, please try again later."
    fi
  fi
}

self_signed_minishift() {
  export DOMAIN=*.$(minishift ip).nip.io

  /bin/bash self-signed-cert.sh

  #Configure Router with generated certificate:

  oc login -u system:admin --insecure-skip-tls-verify=true
  oc project default
  oc delete secret router-certs

  cat domain.crt domain.key > minishift.crt
  oc create secret tls router-certs --key=domain.key --cert=minishift.crt
  oc rollout latest router

  oc create namespace che

  cp rootCA.crt ca.crt
  oc create secret generic self-signed-certificate --from-file=ca.crt -n=che
}

minishift_installation() {
  printInfo "Downloading Minishift binaries"
  curl -L https://github.com/minishift/minishift/releases/download/v$MSFT_RELEASE/minishift-$MSFT_RELEASE-linux-amd64.tgz \
    -o ${CHECTL_REPO}/tmp/minishift-$MSFT_RELEASE-linux-amd64.tar && tar -xvf ${CHECTL_REPO}/tmp/minishift-$MSFT_RELEASE-linux-amd64.tar -C /usr/local/bin --strip-components=1
  printInfo "Starting a new OC cluster."
  minishift profile set ${PROFILE}

  printInfo "Setting github token and start a new minishift VM."
  github_token_set
  minishift start --memory=8192 && eval $(minishift oc-env)

  self_signed_minishift
  printInfo "Successfully installed and initialized minishift"
}

installJQ() {
  installEpelRelease
  yum install --assumeyes -d1 jq
}

load_jenkins_vars() {
    set +x
    eval "$(./env-toolkit load -f jenkins-env.json \
                              CHE_BOT_GITHUB_TOKEN)"
}
