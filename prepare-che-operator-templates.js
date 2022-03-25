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
var deployFolder = path.join(__dirname, 'node_modules', 'eclipse-che-operator', 'deploy/deployment')
var configFolder = path.join(__dirname, 'node_modules', 'eclipse-che-operator', 'config')
var cheOperatorTemplates = path.join(__dirname, 'templates', 'che-operator')

function prepareTemplates() {
    if (fs.existsSync(deployFolder)) {
        fs.copySync(path.join(deployFolder, 'objects', 'checlusters.org.eclipse.che.CustomResourceDefinition.yaml'), path.join(cheOperatorTemplates, 'crds', 'org.eclipse.che_checlusters.yaml'))
        fs.copySync(path.join(configFolder, 'samples', 'org_v2_checluster.yaml'), path.join(cheOperatorTemplates, 'crds', 'org_checluster_cr.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.Deployment.yaml'), path.join(cheOperatorTemplates, 'operator.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.ServiceAccount.yaml'), path.join(cheOperatorTemplates, 'service_account.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.ClusterRoleBinding.yaml'), path.join(cheOperatorTemplates, 'cluster_rolebinding.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.ClusterRole.yaml'), path.join(cheOperatorTemplates, 'cluster_role.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.RoleBinding.yaml'), path.join(cheOperatorTemplates, 'role_binding.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'che-operator.Role.yaml'), path.join(cheOperatorTemplates, 'role.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'leader-election-role.Role.yaml'), path.join(cheOperatorTemplates, 'leader-election-role.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'leader-election-rolebinding.RoleBinding.yaml'), path.join(cheOperatorTemplates, 'leader-election-rolebinding.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'serving-cert.Certificate.yaml'), path.join(cheOperatorTemplates, 'serving-cert.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'selfsigned-issuer.Issuer.yaml'), path.join(cheOperatorTemplates, 'selfsigned-issuer.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'webhook-service.Service.yaml'), path.join(cheOperatorTemplates, 'webhook-service.yaml'))
        fs.copySync(path.join(deployFolder, 'objects', 'manager-config.ConfigMap.yaml'), path.join(cheOperatorTemplates, 'manager-config.yaml'))
    } else if (fs.existsSync(configFolder)) {
        const filterFunc = (src) => {
            var isFile = fs.statSync(src).isFile()
            if (isFile) {
                var filePath = path.basename(src)
                if (filePath === 'role.yaml' ||
                    filePath === 'role_binding.yaml' ||
                    filePath === 'cluster_role.yaml' ||
                    filePath === 'cluster_rolebinding.yaml' ||
                    filePath === 'service_account.yaml') {
                    return true
                }
            } else {
                var dirName = path.basename(src)
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
