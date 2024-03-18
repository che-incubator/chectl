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

function prepareCheOperatorTemplates() {
  const src = path.join(__dirname, 'node_modules', 'eclipse-che-operator', 'deploy', 'deployment', 'kubernetes', 'objects')
  const templates = path.join(__dirname, 'templates', 'che-operator', 'kubernetes')

  fs.copySync(
    path.join(src, '..', 'org_v2_checluster.yaml'),
    path.join(templates, 'crds', 'org_checluster_cr.yaml'))
  fs.copySync(
    path.join(src, 'checlusters.org.eclipse.che.CustomResourceDefinition.yaml'),
    path.join(templates, 'crds', 'org.eclipse.che_checlusters.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.Deployment.yaml'),
    path.join(templates, 'operator.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.ServiceAccount.yaml'),
    path.join(templates, 'service_account.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.ClusterRoleBinding.yaml'),
    path.join(templates, 'cluster_rolebinding.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.ClusterRole.yaml'),
    path.join(templates, 'cluster_role.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.RoleBinding.yaml'),
    path.join(templates, 'role_binding.yaml'))
  fs.copySync(
    path.join(src, 'che-operator.Role.yaml'),
    path.join(templates, 'role.yaml'))
  fs.copySync(
    path.join(src, 'che-operator-service.Service.yaml'),
    path.join(templates, 'webhook-service.yaml'))
  fs.copySync(
    path.join(src, 'che-operator-serving-cert.Certificate.yaml'),
    path.join(templates, 'serving-cert.yaml'))
  fs.copySync(
    path.join(src, 'che-operator-selfsigned-issuer.Issuer.yaml'),
    path.join(templates, 'selfsigned-issuer.yaml'))
  fs.copySync(
    path.join(src, 'org.eclipse.che.ValidatingWebhookConfiguration.yaml'),
    path.join(templates, 'org.eclipse.che.ValidatingWebhookConfiguration.yaml'))
  fs.copySync(
    path.join(src, 'org.eclipse.che.MutatingWebhookConfiguration.yaml'),
    path.join(templates, 'org.eclipse.che.MutatingWebhookConfiguration.yaml'))
}

function prepareDevWorkspaceOperatorTemplates() {
  const src = path.join(__dirname, 'node_modules', 'devworkspace-operator', 'deploy', 'deployment', 'kubernetes')
  const templates = path.join(__dirname, 'templates', 'devworkspace-operator', 'kubernetes')

  fs.copySync(
    path.join(src, 'combined.yaml'),
    path.join(templates, 'combined.yaml'))
}

fs.removeSync(path.join(__dirname, 'templates'))
prepareCheOperatorTemplates()
prepareDevWorkspaceOperatorTemplates()
