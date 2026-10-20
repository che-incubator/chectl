/**
 * Copyright (c) 2019-2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

'use strict'

const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const TEMPLATES = path.join(ROOT, 'templates')

// Fetches operator repository at the given `ref` (a branch, a tag or a commit SHA) into `dest`.
// Operator repos have no package.json, so Yarn 4 cannot install them as git deps.
function fetchRepository(repo, dest) {
  console.log(`Fetching ${repo.name} at ${repo.ref}...`)
  fs.ensureDirSync(dest)
  // GIT_TERMINAL_PROMPT=0 makes an unreachable or renamed remote fail fast
  // instead of blocking on a credentials prompt in an interactive terminal.
  const options = { stdio: 'inherit', cwd: dest, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
  const git = (...args) => {
    try {
      execFileSync('git', args, options)
    } catch (error) {
      throw new Error(
        `Unable to fetch ${repo.name} (${repo.url}) at ${repo.ref}: 'git ${args.join(' ')}' exited with code ${error.status ?? error.code}, see the git output above`,
        { cause: error }
      )
    }
  }
  git('init', '-q', '-b', 'main')
  git('remote', 'add', 'origin', repo.url)
  git('fetch', '-q', '--depth', '1', 'origin', repo.ref)
  git('checkout', '-q', 'FETCH_HEAD')
}

function prepareCheOperatorTemplates(repoDir, templatesDir) {
  const src = path.join(repoDir, 'deploy', 'deployment', 'kubernetes', 'objects')
  const templates = path.join(templatesDir, 'che-operator', 'kubernetes')

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

function prepareDevWorkspaceOperatorTemplates(repoDir, templatesDir) {
  const src = path.join(repoDir, 'deploy', 'deployment', 'kubernetes')
  const templates = path.join(templatesDir, 'devworkspace-operator', 'kubernetes')

  fs.copySync(
    path.join(src, 'combined.yaml'),
    path.join(templates, 'combined.yaml'))
}

const PREPARE_TEMPLATES = {
  'eclipse-che-operator': prepareCheOperatorTemplates,
  'devworkspace-operator': prepareDevWorkspaceOperatorTemplates,
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const repos = packageJson.operatorRepositories

  if (!repos || !Array.isArray(repos)) {
    throw new Error('operatorRepositories not found or invalid in package.json')
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chectl-operators-'))
  try {
    for (const repo of repos) {
      if (!PREPARE_TEMPLATES[repo.name]) {
        throw new Error(`Unknown operator repository: ${repo.name}`)
      }
      fetchRepository(repo, path.join(tmpDir, repo.name))
    }

    fs.removeSync(TEMPLATES)
    for (const repo of repos) {
      PREPARE_TEMPLATES[repo.name](path.join(tmpDir, repo.name), TEMPLATES)
    }
  } finally {
    fs.removeSync(tmpDir)
  }
}

try {
  main()
} catch (error) {
  console.error(`[ERROR] ${error.message}`)
  process.exit(1)
}
