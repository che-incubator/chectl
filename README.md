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
chectl/0.0.2 darwin-x64 node-v8.9.1
$ chectl --help [COMMAND]
USAGE
  $ chectl COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`chectl hello [FILE]`](#chectl-hello-file)
* [`chectl help [COMMAND]`](#chectl-help-command)

## `chectl hello [FILE]`

describe the command here

```
USAGE
  $ chectl hello [FILE]

OPTIONS
  -f, --force
  -h, --help       show CLI help
  -n, --name=name  name to print

EXAMPLE
  $ chectl hello
  hello world from ./src/hello.ts!
```

_See code: [src/commands/hello.ts](https://github.com/l0rd/chectl/blob/v0.0.2/src/commands/hello.ts)_

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
<!-- commandsstop -->
