chectl
======

Eclipse Che CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Build Status](https://travis-ci.org/l0rd/chectl.svg?branch=master)](https://travis-ci.org/l0rd/chectl)
![](https://img.shields.io/david/l0rd/chectl.svg)

<!-- toc -->
* [Installation](#installation)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Installation
### macOS
```bash
curl -sSLO https://github.com/l0rd/chectl/releases/download/latest/chectl-macos \
  && install chectl-macos /usr/local/bin/chectl
```
### Linux
```bash
curl -sSLO https://github.com/l0rd/chectl/releases/download/latest/chectl-linux \
  && install chectl-linux /usr/local/bin/chectl
```
# Usage
```sh-session
$ chectl server:start
running command...

$ chectl server:stop
running command...

$ chectl --help [COMMAND]
USAGE
  $ chectl COMMAND
...
```
# Commands
<!-- commands -->
* [`chectl help [COMMAND]`](#chectl-help-command)
* [`chectl server:start`](#chectl-serverstart)
* [`chectl server:stop`](#chectl-serverstop)
* [`chectl server:update`](#chectl-serverupdate)
* [`chectl workspace:list`](#chectl-workspacelist)
* [`chectl workspace:start`](#chectl-workspacestart)
* [`chectl workspace:stop`](#chectl-workspacestop)

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
  -d, --debug                          Starts chectl in debug mode
  -h, --help                           show CLI help
  -i, --cheimage=cheimage              [default: eclipse/che-server:nightly] Che server container image
  -n, --chenamespace=chenamespace      [default: kube-che] Kubernetes namespace where Che resources will be deployed
  -o, --cheboottimeout=cheboottimeout  (required) [default: 40000] Che server bootstrap timeout (in milliseconds)

  -t, --templates=templates            [default: /Users/mloriedo/github/chectl/src/templates] Path to the templates
                                       folder
```

_See code: [src/commands/server/start.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/start.ts)_

## `chectl server:stop`

stop Eclipse Che Server

```
USAGE
  $ chectl server:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/stop.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/stop.ts)_

## `chectl server:update`

update Eclipse Che Server

```
USAGE
  $ chectl server:update

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/update.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/update.ts)_

## `chectl workspace:list`

list Che workspaces

```
USAGE
  $ chectl workspace:list

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/list.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/list.ts)_

## `chectl workspace:start`

create and start a Che workspace

```
USAGE
  $ chectl workspace:start

OPTIONS
  -f, --devfile=devfile            (required) path to a valid devfile
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/start.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/start.ts)_

## `chectl workspace:stop`

stop a running Che workspace

```
USAGE
  $ chectl workspace:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/stop.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/stop.ts)_
<!-- commandsstop -->
