/*********************************************************************
 * Copyright (c) 2019-2021 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

'use strict'

const fs = require('fs-extra')
const path = require('path')
const deployFolder = path.join(__dirname, 'node_modules', 'eclipse-che-operator', 'deploy/deployment');
const configFolder = path.join(__dirname, 'node_modules', 'eclipse-che-operator', 'config');
const cheOperatorTemplates = path.join(__dirname, 'templates', 'che-operator');

function prepareTemplates() {
  if (fs.existsSync(deployFolder)) {
    for (const platform in ['kubernetes', 'openshift']) {
      fs.copySync(
        path.join(deployFolder, platform, 'org_v2_checluster.yaml'),
        path.join(cheOperatorTemplates, platform, 'crds', 'org_checluster_cr.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'checlusters.org.eclipse.che.CustomResourceDefinition.yaml'),
        path.join(cheOperatorTemplates, platform, 'crds', 'org.eclipse.che_checlusters.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.Deployment.yaml'),
        path.join(cheOperatorTemplates, 'platform,operator.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.ServiceAccount.yaml'),
        path.join(cheOperatorTemplates, platform, 'service_account.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.ClusterRoleBinding.yaml'),
        path.join(cheOperatorTemplates, platform, 'cluster_rolebinding.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.ClusterRole.yaml'),
        path.join(cheOperatorTemplates, platform, 'cluster_role.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.RoleBinding.yaml'),
        path.join(cheOperatorTemplates, platform, 'role_binding.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator.Role.yaml'),
        path.join(cheOperatorTemplates, platform, 'role.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'che-operator-serving-cert.Certificate.yaml'),
        path.join(cheOperatorTemplates, platform, 'serving-cert.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'selfsigned-issuer.Issuer.yaml'),
        path.join(cheOperatorTemplates, platform, 'selfsigned-issuer.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'webhook-service.Service.yaml'),
        path.join(cheOperatorTemplates, platform, 'webhook-service.yaml'))
      fs.copySync(
        path.join(deployFolder, platform, 'objects', 'manager-config.ConfigMap.yaml'),
        path.join(cheOperatorTemplates, platform, 'manager-config.yaml'))
    }
  } else if (fs.existsSync(configFolder)) {
    const filterFunc = (src) => {
      const isFile = fs.statSync(src).isFile();
      if (isFile) {
        const filePath = path.basename(src);
        if (filePath === 'role.yaml' ||
          filePath === 'role_binding.yaml' ||
          filePath === 'cluster_role.yaml' ||
          filePath === 'cluster_rolebinding.yaml' ||
          filePath === 'service_account.yaml') {
          return true
        }
      } else {
        const dirName = path.basename(src);
        if (dirName === 'rbac') {
          return true
        }
      }
    }

    fs.copySync(path.join(configFolder, 'rbac'), cheOperatorTemplates, filterFunc)
    fs.copySync(path.join(configFolder, 'manager', 'manager.yaml'), path.join(cheOperatorTemplates, 'operator.yaml'))
    fs.copySync(path.join(configFolder, 'crd', 'bases'), path.join(cheOperatorTemplates, 'crds'))

    // CheCluster API v2
    let cheClusterCR = path.join(configFolder, 'samples', 'org_v2_checluster.yaml')
    if (!fs.existsSync(cheClusterCR)) {
      // CheCluster API v1
      cheClusterCR = path.join(configFolder, 'samples', 'org.eclipse.che_v1_checluster.yaml')
    }

    // Common file name for both versions
    fs.copySync(cheClusterCR, path.join(cheOperatorTemplates, 'crds', 'org_checluster_cr.yaml'))
  } else {
    throw new Error("Unable to prepare che-operator templates")
  }
}

fs.removeSync(cheOperatorTemplates)
prepareTemplates()
