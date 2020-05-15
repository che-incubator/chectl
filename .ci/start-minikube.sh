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

# Minikube environments config
export MINIKUBE_VERSION=v1.8.2
export KUBERNETES_VERSION=v1.16.2
export MINIKUBE_HOME=$HOME
export CHANGE_MINIKUBE_NONE_USER=true
export KUBECONFIG=$HOME/.kube/config
export TEST_OUTPUT=1

self_signed_minikube() {
  export DOMAIN=*.$(minikube ip).nip.io

  source ${CHECTL_REPO}/.ci/che-cert_generation.sh

  kubectl create namespace che
  kubectl create secret tls che-tls --key=domain.key --cert=domain.crt -n che
  cp rootCA.crt ca.crt
  kubectl create secret generic self-signed-certificate --from-file=ca.crt -n che
}

sudo mount --make-rshared /
sudo mount --make-rshared /proc
sudo mount --make-rshared /sys

# Download minikube binary
curl -Lo kubectl https://storage.googleapis.com/kubernetes-release/release/$KUBERNETES_VERSION/bin/linux/amd64/kubectl && \
  chmod +x kubectl &&  \
sudo mv kubectl /usr/local/bin/

# Download minikube binary
curl -Lo minikube https://storage.googleapis.com/minikube/releases/$MINIKUBE_VERSION/minikube-linux-amd64 && \
  chmod +x minikube && \
  sudo mv minikube /usr/local/bin/

# Configure firewall rules for docker0 network
firewall-cmd --permanent --zone=trusted --add-interface=docker0
firewall-cmd --reload
firewall-cmd --get-active-zones
firewall-cmd --list-all --zone=trusted

# Create kube folder
mkdir "${HOME}"/.kube || true
touch "${HOME}"/.kube/config

# minikube config
minikube config set WantUpdateNotification false
minikube config set WantReportErrorPrompt false
minikube config set WantNoneDriverWarning false
minikube config set vm-driver none
minikube version

# minikube start
minikube start --kubernetes-version=$KUBERNETES_VERSION --extra-config=apiserver.authorization-mode=RBAC

# waiting for node(s) to be ready
JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl get nodes -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1; done

#Give god access to the k8s API
kubectl apply -f - <<EOF
kind: ClusterRole
apiVersion: rbac.authorization.k8s.io/v1beta1
metadata:
  name: cluster-reader
rules:
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["*"]
    verbs: ["*"]

EOF

self_signed_minikube
