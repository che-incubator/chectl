# `chectl` release process

#### Make release changes and push them to your personal fork

```bash
CHE_VERSION="7.7.0" && \
BRANCH_NAME="7.7.x" && \
FORK="l0rd/chectl" && \
./make-release.sh ${CHE_VERSION} ${BRANCH_NAME} ${FORK}
```

#### Create a PR

```bash
BASE_REPO="che-incubator" && \
HEAD_REPO="l0rd" && \
REALEASE_ISSUE_LINK="https://github.com/eclipse/che/issues/15504" && \
hub pull-request --browse \
                 --base ${BASE_REPO}:${BRANCH_NAME} \
                 --head ${HEAD_REPO}:${BRANCH_NAME} \
                 -m "chore(release): release version ${CHE_VERSION}" \
                 -m "### What does this PR do?" \
                 -m "Release version ${CHE_VERSION}" \
                 -m "### What issues does this PR fix or reference?" \
                 -m "${REALEASE_ISSUE_LINK}"
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
