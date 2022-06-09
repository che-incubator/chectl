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
const cheOperatorTemplates = path.join(__dirname, 'templates', 'che-operator');

function prepareTemplates() {
  for (const platform of ['kubernetes', 'openshift']) {
    fs.copySync(
      path.join(deployFolder, platform, 'org_v2_checluster.yaml'),
      path.join(cheOperatorTemplates, platform, 'crds', 'org_checluster_cr.yaml'))
    fs.copySync(
      path.join(deployFolder, platform, 'objects', 'checlusters.org.eclipse.che.CustomResourceDefinition.yaml'),
      path.join(cheOperatorTemplates, platform, 'crds', 'org.eclipse.che_checlusters.yaml'))
    fs.copySync(
      path.join(deployFolder, platform, 'objects', 'che-operator.Deployment.yaml'),
      path.join(cheOperatorTemplates, platform, 'operator.yaml'))
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
      path.join(deployFolder, platform, 'objects', 'che-operator-service.Service.yaml'),
      path.join(cheOperatorTemplates, platform, 'webhook-service.yaml'))
  }

  fs.copySync(
    path.join(deployFolder, 'kubernetes', 'objects', 'che-operator-serving-cert.Certificate.yaml'),
    path.join(cheOperatorTemplates, 'kubernetes', 'serving-cert.yaml'))
  fs.copySync(
    path.join(deployFolder, 'kubernetes', 'objects', 'che-operator-selfsigned-issuer.Issuer.yaml'),
    path.join(cheOperatorTemplates, 'kubernetes', 'selfsigned-issuer.yaml'))
}

fs.removeSync(cheOperatorTemplates)
prepareTemplates()
