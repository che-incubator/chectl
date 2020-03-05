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
#!/usr/bin/env bash
# exit immediately when a command fails
set -e
# only exit with zero if all commands of the pipeline exit successfully
set -o pipefail
# error on unset variables
set -u
# print each command before executing it
set -x

    export MINIKUBE_VERSION=v1.2.0
    export KUBERNETES_VERSION=v1.14.5

    sudo mount --make-rshared /
    sudo mount --make-rshared /proc
    sudo mount --make-rshared /sys

    curl -Lo kubectl https://storage.googleapis.com/kubernetes-release/release/$KUBERNETES_VERSION/bin/linux/amd64/kubectl && \
        chmod +x kubectl &&  \
        sudo mv kubectl /usr/local/bin/
    curl -Lo minikube https://storage.googleapis.com/minikube/releases/$MINIKUBE_VERSION/minikube-linux-amd64 && \
        chmod +x minikube && \
        sudo mv minikube /usr/local/bin/

    export MINIKUBE_HOME=$HOME
    export CHANGE_MINIKUBE_NONE_USER=true
    firewall-cmd --permanent --zone=trusted --add-interface=docker0
    firewall-cmd --reload
    firewall-cmd --get-active-zones
    firewall-cmd --list-all --zone=trusted
    mkdir "${HOME}"/.kube || true
    touch "${HOME}"/.kube/config

    export KUBECONFIG=$HOME/.kube/config

    # minikube config
    minikube config set WantUpdateNotification false
    minikube config set WantReportErrorPrompt false
    minikube config set WantNoneDriverWarning false
    minikube config set vm-driver none
    export TEST_OUTPUT=1
    minikube version

    minikube start --kubernetes-version=$KUBERNETES_VERSION --extra-config=apiserver.authorization-mode=RBAC
        # waiting for node(s) to be ready
    JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl get nodes -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1; done

    # waiting for kube-addon-manager to be ready
    JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl -n kube-system get pods -lcomponent=kube-addon-manager -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1;echo "waiting for kube-addon-manager to be available"; kubectl get pods --all-namespaces; done

    # waiting for kube-dns to be ready
    JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl -n kube-system get pods -lk8s-app=kube-dns -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1;echo "waiting for kube-dns to be available"; kubectl get pods --all-namespaces; done

    kubectl apply -f ${CHECTL_REPO}/.ci/minikube-rbac.yaml
}
#TEST
