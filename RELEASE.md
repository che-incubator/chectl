# `chectl` release process

#### Make release changes and push them to your personal fork

```bash
CHE_VERSION="7.7.0" && \
BRANCH_NAME="7.7.x" && \
FORK="l0rd/chectl" && \
./make-release.sh ${CHE_VERSION} ${BRANCH_NAME} ${FORK}
```

#### Create a PR using `hub`

[hub](https://hub.github.com/) is an extension to command-line git that helps you do everyday GitHub tasks without ever leaving the terminal.

```bash
GH_USER="l0rd" && \
RELEASE_ISSUE_LINK="https://github.com/eclipse/che/issues/15504" && \
hub pull-request --browse \
                 --base che-incubator:${BRANCH_NAME} \
                 --head ${GH_USER}:${BRANCH_NAME} \
                 -m "chore(release): release version ${CHE_VERSION}" \
                 -m "### What does this PR do?" \
                 -m "Release version ${CHE_VERSION}" \
                 -m "### What issues does this PR fix or reference?" \
                 -m "${RELEASE_ISSUE_LINK}"
```

Wait for a review approval and then merge it.

#### Release

1. Delete the old chectl **release** branch from GitHub if it exist ([manually](https://github.com/che-incubator/chectl/branches))
2. Push to **release** branch:

    ```bash
    GIT_REMOTE_UPSTREAM=git@github.com:che-incubator/chectl.git && \
    git push ${GIT_REMOTE_UPSTREAM} ${BRANCH_NAME}:release
    ```

3. Track [TravisCI Job](https://travis-ci.org/che-incubator/chectl/branches)
