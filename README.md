chectl
======

Eclipse Che CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/chectl.svg)](https://npmjs.org/package/chectl)
[![Downloads/week](https://img.shields.io/npm/dw/chectl.svg)](https://npmjs.org/package/chectl)
[![License](https://img.shields.io/npm/l/chectl.svg)](https://github.com/l0rd/chectl/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g chectl
$ chectl COMMAND
running command...
$ chectl (-v|--version|version)
chectl/0.0.2 linux-x64 node-v8.12.0
$ chectl --help [COMMAND]
USAGE
  $ chectl COMMAND
...
```
<!-- usagestop -->
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

Start Eclipse Che Server

```
USAGE
  $ chectl server:start

OPTIONS
  -h, --help                           show CLI help
  -i, --cheimage=cheimage              [default: eclipse/che-server:nightly] Che server container image
  -n, --chenamespace=chenamespace      [default: kube-che] Kubernetes namespace where Che resources will be deployed
  -o, --cheboottimeout=cheboottimeout  (required) [default: 40000] Che server bootstrap timeout (in milliseconds)
  -t, --templates=templates            [default: /home/mario/github/chectl/src/templates] Path to the templates folder
```

_See code: [src/commands/server/start.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/start.ts)_

## `chectl server:stop`

Stop Eclipse Che Server

```
USAGE
  $ chectl server:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/stop.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/stop.ts)_

## `chectl server:update`

Update Eclipse Che Server

```
USAGE
  $ chectl server:update

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che resources will be deployed
```

_See code: [src/commands/server/update.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/server/update.ts)_

## `chectl workspace:list`

List Che workspaces

```
USAGE
  $ chectl workspace:list

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/list.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/list.ts)_

## `chectl workspace:start`

Create and start a Che workspace

```
USAGE
  $ chectl workspace:start

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che server deployed
```

_See code: [src/commands/workspace/start.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/start.ts)_

## `chectl workspace:stop`

Stop a running Che workspace

```
USAGE
  $ chectl workspace:stop

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  [default: kube-che] Kubernetes namespace where Che server is deployed
```

_See code: [src/commands/workspace/stop.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/workspace/stop.ts)_
<!-- commandsstop -->
