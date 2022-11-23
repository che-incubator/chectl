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

export const ECLIPSE_CHE_INCUBATOR_ORG = 'che-incubator'
export const CHECTL_REPO = 'chectl'

export interface TagInfo {
  name: string
  commit: {
    sha: string
    url: string
  }
  zipball_url: string
}

export class CheGithubClient {
  private readonly octokit: Octokit

  constructor() {
    this.octokit = new Octokit({
      baseUrl: 'https://api.github.com',
      userAgent: 'chectl',
      auth: process.env.GITHUB_TOKEN,
    })
  }

  /**
   * Finds the latest tag of format x.y.z, where x,y and z are numbers.
   * @param tags repository tags list returned by octokit
   */
  public getLatestTag(tags: TagInfo[]): TagInfo {
    if (tags.length === 0) {
      throw new Error('Tag list should not be empty')
    }

    const sortedSemanticTags = this.sortSemanticTags(tags)
    return sortedSemanticTags[0]
  }

  /**
   * Sorts given tags. First is the latest.
   * All tags should use semantic versioning in form x.y.z, where x,y and z are numbers.
   * If a tag is not in the descrbed above format, it will be ignored.
   * @param tags list of tags to sort
   */
  private sortSemanticTags(tags: TagInfo[]): TagInfo[] {
    interface SemanticTagData {
      major: number
      minor: number
      patch: number
      data: TagInfo
    }

    const semanticTags: SemanticTagData[] = tags.reduce<SemanticTagData[]>((acceptedTags, tagInfo, _index: number, _all: TagInfo[]) => {
      // Remove 'v' prefix if any
      if (tagInfo.name.startsWith('v')) {
        tagInfo.name = tagInfo.name.substring(1)
      }

      const versionComponents = tagInfo.name.split('.')
      // Accept the tag only if it has format x.y.z and z has no suffix (like '-RC2' or '-5e87ab1')
      if (versionComponents.length === 3 && (parseInt(versionComponents[2], 10).toString() === versionComponents[2])) {
        acceptedTags.push({
          major: parseInt(versionComponents[0], 10),
          minor: parseInt(versionComponents[1], 10),
          patch: parseInt(versionComponents[2], 10),
          data: tagInfo,
        })
      }
      return acceptedTags
    }, [])
    if (semanticTags.length === 0) {
      // Should never happen
      throw new Error('There is no semantic tags')
    }

    const sortedSemanticTags = semanticTags.sort((semTagA: SemanticTagData, semTagB: SemanticTagData) => {
      if (semTagA.major !== semTagB.major) {
        return semTagB.major - semTagA.major
      } else if (semTagA.minor !== semTagB.minor) {
        return semTagB.minor - semTagA.minor
      } else if (semTagA.patch !== semTagB.patch) {
        return semTagB.patch - semTagA.patch
      } else {
        return 0
      }
    })

    return sortedSemanticTags.map(tag => tag.data)
  }

  private async getCommitData(owner: string, repo: string, commitId: string) {
    const commitDataResponse = await this.octokit.repos.getCommit({ owner, repo, ref: commitId })
    if (commitDataResponse.status !== 200) {
      throw new Error(`Failed to get commit data from the repository '${repo}'. Request: ${commitDataResponse.url}, response: ${commitDataResponse.status}`)
    }
    return commitDataResponse.data
  }

  /**
   * Returns date of the given commit
   * @param owner oerganization of the repository
   * @param repo repository name
   * @param commitId ID of commit to get date for
   */
  async getCommitDate(owner: string, repo: string, commitId: string): Promise<string> {
    const commitData = await this.getCommitData(owner, repo, commitId)
    if (!commitData.commit.committer || !commitData.commit.committer.date) {
      throw new Error(`Failed to read '${commitId}' commit date`)
    }
    return commitData.commit.committer.date
  }
}
