/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { Octokit } from '@octokit/rest'
import * as execa from 'execa'
import * as fs from 'fs-extra'
import {KubeClient} from '../../src/api/kube-client'
import {CheGithubClient, TagInfo} from '../../src/api/github-client'

export const NAMESPACE = 'eclipse-che'
export const CHECTL_REPONAME = 'chectl'

export const OWNER = 'che-incubator'

//Utilities to help e2e tests
export class E2eHelper {
  private readonly octokit: Octokit
  protected kubeHelper: KubeClient
  protected devfileName: string

  constructor() {
    this.kubeHelper = KubeClient.getInstance()
    // generate-name from https://raw.githubusercontent.com/eclipse/che-devfile-registry/master/devfiles/quarkus/devfile.yaml
    this.devfileName = 'quarkus-'
    this.octokit = new Octokit({
      baseUrl: 'https://api.github.com',
      userAgent: 'chectl',
      auth: process.env.GITHUB_TOKEN,
    })
  }

  static getChectlBinaries(): string {
    if (process.env.ASSEMBLY_MODE === 'on') {
      return 'chectl'
    }
    return `${process.cwd()}/bin/run`
  }

  /**
   * Runs given command and returns its output (including error stream if any).
   * See also runCliCommandVerbose for debug purposes.
   */
  async runCliCommand(command: string, args?: string[], printOutput = true): Promise<string> {
    if (printOutput) {
      // tslint:disable-next-line: no-console
      console.log(`Running command: ${command} ${args ? args.join(' ') : ''}`)
    }

    const { exitCode, stdout, stderr } = await execa(command, args, { shell: true })

    if (printOutput) {
      // tslint:disable-next-line: no-console
      console.log(stdout)
      if (exitCode !== 0) {
        // tslint:disable-next-line: no-console
        console.log(stderr)
      }
    }

    expect(exitCode).toEqual(0)

    return stdout
  }

  // Utility to wait a time
  sleep(ms: number): Promise<any> {
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async waitForVersionInCheCR(version: string, timeoutMs: number): Promise<void> {
    const delayMs = 5 * 1000

    let totalTimeMs = 0
    while (totalTimeMs < timeoutMs) {
      const cheCR = await this.kubeHelper.getCheCluster(NAMESPACE)
      if (cheCR && cheCR.status && cheCR.status.cheVersion === version) {
        return
      }
      await this.sleep(delayMs)
      totalTimeMs += delayMs
    }
    throw new Error(`Che CR version ${version} has not appeared in ${timeoutMs / 1000}s`)
  }

  async waitForCheServerImageTag(tag: string, timeoutMs: number): Promise<void> {
    const delayMs = 5 * 1000
    const chePodNameRegExp = new RegExp('che-[0-9a-f]+-.*')

    let totalTimeMs = 0
    while (totalTimeMs < timeoutMs) {
      const pods = (await this.kubeHelper.listNamespacedPod(NAMESPACE)).items
      const pod = pods.find((pod => pod.metadata && pod.metadata.name && pod.metadata.name.match(chePodNameRegExp)))
      if (pod && pod.status && pod.status.containerStatuses && pod.status.containerStatuses[0].image) {
        const imageTag = pod.status.containerStatuses[0].image.split(':')[1]
        if (imageTag === tag) {
          return
        }
      }
      await this.sleep(delayMs)
      totalTimeMs += delayMs
    }
    throw new Error(`Che server image tag ${tag} has not appeared in ${timeoutMs / 1000}s `)
  }

  /**
   * Gets last 50 tags from the given repository.
   * @param repo repository name to list tag in
   */
  public async listLatestTags(repo: string): Promise<TagInfo[]> {
    let response = await this.octokit.repos.listTags({ owner: OWNER, repo, per_page: 50 })
    const tags = response.data
    return tags
  }

  /**
   * Get previous version from chectl repository
   */
  async getLatestReleasedVersion(): Promise<string> {
    const githubClient = new CheGithubClient()
    const latestTag = githubClient.getLatestTag(await this.listLatestTags(CHECTL_REPONAME))
    return latestTag.name
  }

  /**
   * Check if VERSION file exists and return content. In case if Version file doesn't exists
   * We are not in release branch and return `next`
   */
  getNewVersion(): string {
    const rootDir = process.cwd()
    try {
      if (fs.existsSync(`${rootDir}/VERSION`)) {
        return fs.readFileSync(`${rootDir}/VERSION`).toString().trim()
      }
      return 'next'
    } catch (error) {
      throw new Error(`Error reading version file: ${error}`)
    }
  }
}
