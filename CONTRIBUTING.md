# Contributing

The development flow includes:

- [Contributing](#contributing)
  - [Create workspace, clone sources](#create-workspace-clone-sources)
  - [Build](#build)
  - [Run tests](#run-tests)
  - [Run](#run)
  - [Generate Devfile](#generate-devfile)
  - [Create Workspace](#create-workspace)
  - [Package binaries](#package-binaries)
  - [Push changes, provide Pull Request](#push-changes-provide-pull-request)
  - [Make Release](#make-release)

## Create workspace, clone sources

To create a workpace you can use [devfile](devfile.yaml):

```
$ chectl workspace:start -f https://raw.githubusercontent.com/che-incubator/chectl/main/devfile.yaml
```

> See more about [devfile](https://redhat-developer.github.io/devfile)

After starting the workspace Theia will clone sources of `chectl` to `/projects/chectl` directory.

`chectl` is written in TypeScript. For its development there is a dedicated `dev` container which has preinstalled software for comfortable development. That allows the developer to build, test and launch `chectl` inside the container.

You workspace is initialized with a list of commands described in the [devfile](devfile.yaml) in `commands` section. Those command allow you to:
- build
- test
- generate devfile
- create workspace
- package binaries
- format sources

You can run commands in one of three ways.

1. It an easiest way is to use `My Workspace` panel at the left. You can launch commands by simple click.

2. `Terminal => Run Task...` menu. You can fin and pick a command in the appeared command palette.

3. Manually by opening a terminal in the `dev` container and running commands in `/projects/chectl` directory.

## Build

```bash
yarn
```

Open `My Workspace` panel at the left and launch `Build` command. It will run `yarn` command in `/projects/chectl` directory inside `dev` container. The command will install all necessary dependencies and compile the project. Upon successfull assembly, a new `bin` directory will appear in project directory and will have two files: `run` and `run.cmd`.


## Run tests

```bash
yarn test
```

Tests for `chectl` are written using `jest` framework.
To run tests, go to `My Workspace` panel, find and launch `Test` command. The command will run `yarn test` inside `dev` container.
Testing summary will be printed to the output.


## Run

```bash
./bin/run --help
```

To test ensure `chectl` is built successfully, launch `Run` command. It wil run `chectl` with `--help` directive.


## Generate Devfile

```bash
./bin/run devfile:generate \
    --name="chectl-test" \
    --language="typescript" \
    --dockerimage="eclipse/che-theia-dev:next" \
    --git-repo="https://github.com/che-incubator/chectl.git" \
    --command="yarn" > /projects/sample.devfile
```

We added a command which generates a simple devfile `/projects/sample.devfile`. Workspace created from this devfile will have `chectl` project with running TypeScript language server. There will be a dev container for building, running and debugging `chectl`. It will be possible to easily build `chectl` by running `yarn` command from `My Workspace`.

## Create Workspace

> We still found a solution how to create a workspace by a command from container.

```bash
# upload devfile content to clbin, save link into a file
cat /projects/sample.devfile | curl -F 'clbin=<-' https://clbin.com > /projects/clbin

# run chectl, pass the given URI
uri=$(cat /projects/clbin); ./run workspace:start -f=$uri
```

To create a workspsace run `Create Workspace` command from `My Workspace`. The command will upload content of the generated `/projects/sample.devfile` devfile to https://clbin.com. And then will use given public URI to the devfile when running `chectl`.

> See more about [clbin](https://clbin.com/)

## Package binaries
For packaging binaries, [oclif](https://github.com/oclif/dev-cli) is used. It generates packages for Linux, Windows and MacOS operation systems and puts the result in `dist/channels/stable` directory.
To start packaging just run `Package Binaries` commands from `My Workspace`. It will run the following in `/projects/chectl` directory.

```bash
yarn oclif-dev pack
```

> Note: you need to build your `chectl` before by `yarn` command, or install all node packages by running `npm install` in `/projects/chectl` directory.

## Push changes, provide Pull Request

`chectl` is using several Pull Request checks
 - [Conventional Commits](https://conventionalcommits.org) convention for the commit messages.
There is a required Pull Request check named `Semantic Pull Request` that is ensuring that all commits messages are correctly setup. In order to merge a Pull Request, it has to be green.

- Signed Commits. Each commit needs to have the `Signed-off` part
It needs to be added on the commit message:
```
feat(hello): This is my first commit message

Signed-off-by: John Doe <chectl@eclipse.org>
```

Git even has a -s command line option to append this automatically to your commit message:
```
$ git commit -s -m 'feat(hello): This is my first commit message'
```

- Unit tests with Travis-CI. It will ensure that `yarn test` command is passing.

All these checks are mandatory in order to have the Pull Request merged.

## Make Release

Create 7.0.0 version

```bash
$ ./make-release.sh 7.0.0
```

To run the script with docker env
```bash
$ ./run-script-in-docker.sh make-release.sh 7.0.0
```

Commit the changes of the script and then, push release branch by overriding current remote release branch