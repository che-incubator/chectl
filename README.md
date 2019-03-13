chectl
======

[Eclipse Che](https://github.com/eclipse/che/) CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Build Status](https://travis-ci.org/che-incubator/chectl.svg?branch=master)](https://travis-ci.org/che-incubator/chectl)
![](https://img.shields.io/david/che-incubator/chectl.svg)

[![asciicast](https://asciinema.org/a/216201.svg)](https://asciinema.org/a/216201)


<!-- toc -->
* [Installation](#installation)
* [Usage](#usage)
* [Commands](#commands)
* [Contributing](#contributing)
<!-- tocstop -->
# Installation

Binary downloads of `chectl` can be found on [the Release page](https://github.com/che-incubator/chectl/releases).

Download the `chectl` binary and add it to your PATH.

Currently `chectl` requires [minikube](https://github.com/kubernetes/minikube#installation) and [helm](https://github.com/helm/helm#install) to be locally installed.

# Usage
```sh-session
$ chectl server:start
running command...

$ chectl server:stop
running command...

$ chectl workspace:start --devfile
running command...

$ chectl --help [COMMAND]
USAGE
  $ chectl COMMAND
...
```
# Commands
<!-- commands -->
* [`chectl autocomplete [SHELL]`](#chectl-autocomplete-shell)
* [`chectl help [COMMAND]`](#chectl-help-command)
* [`chectl server:start`](#chectl-serverstart)
* [`chectl server:stop`](#chectl-serverstop)
* [`chectl server:update`](#chectl-serverupdate)
* [`chectl workspace:inject`](#chectl-workspaceinject)
* [`chectl workspace:list`](#chectl-workspacelist)
* [`chectl workspace:start`](#chectl-workspacestart)
* [`chectl workspace:stop`](#chectl-workspacestop)

## `chectl autocomplete [SHELL]`

display autocomplete installation instructions

```
USAGE
  $ chectl autocomplete [SHELL]

ARGUMENTS
  SHELL  shell type

OPTIONS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

EXAMPLES
  $ chectl autocomplete
  $ chectl autocomplete bash
  $ chectl autocomplete zsh
  $ chectl autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v0.1.0/src/commands/autocomplete/index.ts)_

## `chectl help [COMMAND]`

display help for chectl

```
USAGE
  $ chectl help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.1.4/src/commands/help.ts)_

## `chectl server:start`

start Eclipse Che Server

```
USAGE
  $ chectl server:start

OPTIONS
  -a, --installer=installer            [default: helm] Installer type. Valid values are "helm" and "operator"

  -b, --domain=domain                  Domain of the Kubernetes/OpenShift cluster (e.g.
                                       starter-us-east-2.openshiftapps.com or <local-ip>.nip.io)

  -d, --debug                          Starts chectl in debug mode

  -h, --help                           show CLI help

  -i, --cheimage=cheimage              [default: eclipse/che-server:nightly] Che server container image

  -m, --multiuser                      Starts che in multi-user mode

  -n, --chenamespace=chenamespace      [default: che] Kubernetes namespace where Che resources will be deployed

  -o, --cheboottimeout=cheboottimeout  (required) [default: 40000] Che server bootstrap timeout (in milliseconds)

  -p, --platform=platform              [default: minikube] Type of Kubernetes platform. Valid values are "minikube",
                                       "minishift".

  -s, --tls                            Enable TLS encryption and multi-user mode

  -t, --templates=templates            [default: templates] Path to the templates folder
```

_See code: [src/commands/server/start.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/start.ts)_

## `chectl server:stop`

stop Eclipse Che Server

```
USAGE
  $ chectl server:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/stop.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/stop.ts)_

## `chectl server:update`

update Eclipse Che Server

```
USAGE
  $ chectl server:update

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/update.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/update.ts)_

## `chectl workspace:inject`

inject configurations and tokens in a Che Workspace

```
USAGE
  $ chectl workspace:inject

OPTIONS
  -c, --container=container        [default: dev] Target container
  -h, --help                       show CLI help
  -k, --kubeconfig                 Inject the local Kubernetes configuration
  -n, --chenamespace=chenamespace  [default: che] Kubernetes namespace where Che workspace is running
  -w, --workspace=workspace        Target workspace
```

_See code: [src/commands/workspace/inject.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/inject.ts)_

## `chectl workspace:list`

list Che workspaces

```
USAGE
  $ chectl workspace:list

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/list.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/list.ts)_

## `chectl workspace:start`

create and start a Che workspace

```
USAGE
  $ chectl workspace:start

OPTIONS
  -f, --devfile=devfile                  path to a valid devfile
  -h, --help                             show CLI help
  -n, --chenamespace=chenamespace        [default: che] kubernetes namespace where Che server is deployed
  -w, --workspaceconfig=workspaceconfig  path to a valid workspace configuration json file
```

_See code: [src/commands/workspace/start.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/start.ts)_

## `chectl workspace:stop`

stop a running Che workspace

```
USAGE
  $ chectl workspace:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/stop.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/stop.ts)_
<!-- commandsstop -->

# Contributing

Clone the repository:

```bash
git clone https://github.com/che-incubator/chectl.git
cd chectl
```

Build the source code and run `chectl`:

```bash
yarn
./bin/run --help
```

Run the tests:

```bash
yarn test
```

Package the binary

```bash
yarn pack
pkg . -t node10-linux-x64,node10-macos-x64,node10-win-x64 --out-path ./bin/
```
