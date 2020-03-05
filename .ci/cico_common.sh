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

install_required_packages() {
  # Install EPEL repo
  if yum repolist | grep epel; then
    printInfo "Epel already installed, skipping instalation."
  else
    #excluding mirror1.ci.centos.org
    printInfo "Installing epel..."
    yum install -d1 --assumeyes epel-release
    yum update --assumeyes -d1
  fi
  # Get all the deps in
  printInfo 'Installing required virtualization packages installed'
  yum -y install libvirt qemu-kvm
}

start_libvirt() {
  systemctl start libvirtd
}

install_node_deps() {
  curl -sL https://rpm.nodesource.com/setup_10.x | bash -
  yum-config-manager --add-repo https://dl.yarnpkg.com/rpm/yarn.repo
  yum install -y nodejs yarn git
}

setup_kvm_machine_driver() {
  printInfo "Start to install KVM virtual machine"

  yum install -y qemu-kvm libvirt libvirt-python libguestfs-tools virt-install

  curl -L https://github.com/dhiltgen/docker-machine-kvm/releases/download/v0.10.0/docker-machine-driver-kvm-centos7 -o /usr/local/bin/docker-machine-driver-kvm
  chmod +x /usr/local/bin/docker-machine-driver-kvm

  systemctl enable libvirtd
  systemctl start libvirtd

  virsh net-list --all
  printInfo "KVM has been installed successfully"

}

minishift_installation() {
  printInfo "Downloading Minishift binaries"
  curl -L https://github.com/minishift/minishift/releases/download/v$MSFT_RELEASE/minishift-$MSFT_RELEASE-linux-amd64.tgz \
    -o ${CHECTL_REPO}/tmp/minishift-$MSFT_RELEASE-linux-amd64.tar && tar -xvf ${CHECTL_REPO}/tmp/minishift-$MSFT_RELEASE-linux-amd64.tar -C /usr/local/bin --strip-components=1
  echo "[INFO] Starting a new OC cluster."
  minishift profile set ${PROFILE}
  minishift start --memory=${RAM_MEMORY} && eval $(minishift oc-env)
  oc login -u system:admin
  printInfo "Successfully installed and initialized minishift"
}

minikube_installation() {
  curl -Lo minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64 \
    && chmod +x minikube

  cp minikube /usr/local/bin && rm minikube
  export CHANGE_MINIKUBE_NONE_USER=true
  minikube start --memory=8192 --vm-driver=none


  printInfo "Minikube was started"
}
#TEST
