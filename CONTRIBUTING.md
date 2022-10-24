# Contributing

The development flow includes:

- [Contributing](#contributing)
  - [Start Workspace](#start-workspace)
  - [Build](#build)
  - [Run tests](#run-tests)
  - [Run](#run)
  - [Package binaries](#package-binaries)
  - [Push changes, provide Pull Request](#push-changes-provide-pull-request)
  - [Make Release](#make-release)

## Start Workspace

To provision a chectl development environment using Eclipse Che, append the URL of the chectl repository to the URL of your Che host, and then visit the resulting URL in your browser. For example, to create a workspace in the Red Hat Developer Sandbox, use the following URL:

```
https://workspaces.openshift.com/#https://github.com/che-incubator/chectl
```

> See more about [devfile](https://devfile.io/)
> See more about [workspace URLs](https://www.eclipse.org/che/docs/stable/end-user-guide/starting-a-new-workspace-with-a-clone-of-a-git-repository/)

After starting the workspace, Che will clone sources of `chectl` to the `/projects/chectl` directory.

`chectl` is written in TypeScript. For its development, there is a dedicated `dev` container that has preinstalled software for comfortable development. This allows the developer to build, test, and launch `chectl` inside the container.

Your workspace will be initialized with a list of commands described in the [tasks.json](.vscode/tasks.json) file. The commands are:
- Build
- Test
- Run
- Package Binaries
- Format Sources

You can run commands through the **Terminal** menu by clicking **Terminal => Run Task... ** and selecting the desired task. 

## Build

```bash
yarn
```

Running the  `[Chectl] Build` command will run `yarn` in the `/projects/chectl` directory inside `dev` container. The command will install all necessary dependencies and compile the project. Upon successful assembly, a new `bin` directory will appear in the project directory and will have two files: `run` and `run.cmd`.


## Run tests

```bash
yarn test
```

Tests for `chectl` are written by using the [jest](https://jestjs.io/docs/getting-started) framework.
To run tests, find and launch the `[Chectl] Test` command. The command will run `yarn test` inside `dev` container.
Testing summary will be printed to the output.


## Run

```bash
./bin/run --help
```

To test ensure `chectl` is built successfully, launch the `[Chectl] Run` command. It wil run `chectl` with `--help` directive.

## Package binaries
For packaging binaries, [oclif](https://github.com/oclif/dev-cli) is used. It generates packages for Linux, Windows, and MacOS operating systems and puts the result in the `dist/channels/stable` directory.
To start packaging, just run the `[Chectl] Package Binaries` command. It will run the following in the `/projects/chectl` directory:

```bash
yarn oclif-dev pack
```

> Note: you need to build your `chectl` before by `yarn` command, or install all node packages by running `npm install` in `/projects/chectl` directory.

## Push changes, provide Pull Request

`chectl` uses several Pull Request checks:
 - The [Conventional Commits](https://conventionalcommits.org) convention for the commit messages.
There is a required pull request check named **Semantic Pull Request** that ensures that all commit messages are correctly set up. In order to merge a pull request, it has to be green.

- Signed Commits. Each commit needs to be `Signed-off` in the commit message:
  ```
  feat(hello): This is my first commit message

  Signed-off-by: John Doe <chectl@eclipse.org>
  ```
  
  Use the git `-s` command line option to append this automatically to your commit message:
  
  ```
  $ git commit -s -m 'feat(hello): This is my first commit message'
  ```

- Unit tests with Travis-CI will ensure that the `yarn test` command passes.

All these checks are mandatory in order to have the pull request merged.

## Make Release

Create 7.0.0 version

```bash
$ ./make-release.sh 7.0.0
```

To run the script with docker env
```bash
$ ./run-script-in-docker.sh make-release.sh 7.0.0
```

Commit the changes of the script and then push to the release branch by overriding the current remote release branch.