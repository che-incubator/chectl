chectl
======

[Eclipse Che®](https://github.com/eclipse/che/) CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![codecov](https://codecov.io/gh/che-incubator/chectl/branch/main/graph/badge.svg?token=ZBQtKMeiYu)](https://codecov.io/gh/che-incubator/chectl)

[![asciicast](https://asciinema.org/a/216201.svg)](https://asciinema.org/a/216201)

## Report issues

Issues are tracked on the main Eclipse Che® Repository: https://github.com/eclipse/che/issues

[![New questions](https://img.shields.io/badge/New-question-blue.svg?style=flat-curved)](https://github.com/eclipse/che/issues/new?labels=area/chectl,kind/question)
[![New bug](https://img.shields.io/badge/New-bug-red.svg?style=flat-curved)](https://github.com/eclipse/che/issues/new?labels=area/chectl,kind/bug)

## Table Of Contents

<!-- toc -->
* [Installation](#installation)
* [Updating](#updating)
* [Usage](#usage)
* [Commands](#commands)
* [Contributing](#contributing)
* [Builds](#builds)
* [License](#license)
* [Trademark](#trademark)
<!-- tocstop -->
# Installation

There are two channels of `chectl`: `stable` and `next`

Stable is for all tagged versions of Eclipse Che®. Next is updated after each commit/Pull Request being merged in main branch of the [Chectl repository](https://github.com/che-incubator/chectl).

If you're using Windows x64, here is how to install chectl by using one single PowerShell command:

- For `stable` channel:
```
C:\Users> Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://che-incubator.github.io/chectl/install.ps1'))
```

- For `next` channel:
```
C:\Users> $CHANNEL="next"; Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://che-incubator.github.io/chectl/install.ps1'))
```

If you're using linux or macOS, here is how to install chectl by using one single command:

- For `stable` channel:
```
$ bash <(curl -sL  https://che-incubator.github.io/chectl/install.sh)
```

- For `next` channel:
```
$ bash <(curl -sL  https://che-incubator.github.io/chectl/install.sh) --channel=next
```

Manual install:

1) Download a .tgz file based on your Operating System / Arch from [https://github.com/che-incubator/chectl/releases](https://github.com/che-incubator/chectl/releases)
2) Unpack the assembly
3) Move `chectl` folder into a folder like `$HOME/chectl`
4) Add alias `alias chectl=$HOME/chectl/bin/run`

# Updating

1) Download a .tgz file based on your Operating System / Arch from [https://github.com/che-incubator/chectl/releases](https://github.com/che-incubator/chectl/releases)
2) Unpack the assembly into a local repository
```bash
CHECTL_VERSION=<DOWNLOADED_CHECTL_VERSION>
CHECTL_BINARIES=<DOWNLOADED_BINARIES_PATH>

CLIENT_DIR=${XDG_DATA_HOME:="$(cd && pwd)/.local/share"}/chectl/client/${CHECTL_VERSION}
mkdir ${CLIENT_DIR} -p
tar -xzf ${CHECTL_BINARIES} -C ${CLIENT_DIR} --strip-components=1
```
3) Update `chectl` from the local repository `chectl update --from-local` by prompting the downloaded version

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
* [`chectl autocomplete [SHELL]`](#chectl-autocomplete-shell)
* [`chectl commands`](#chectl-commands)
* [`chectl help [COMMANDS]`](#chectl-help-commands)
* [`chectl update [CHANNEL]`](#chectl-update-channel)
* [`chectl version`](#chectl-version)

## `chectl autocomplete [SHELL]`

display autocomplete installation instructions

```
USAGE
  $ chectl autocomplete [SHELL] [-r]

ARGUMENTS
  SHELL  (zsh|bash|powershell) Shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  display autocomplete installation instructions

EXAMPLES
  $ chectl autocomplete

  $ chectl autocomplete bash

  $ chectl autocomplete zsh

  $ chectl autocomplete powershell

  $ chectl autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v2.3.9/src/commands/autocomplete/index.ts)_

## `chectl commands`

list all the commands

```
USAGE
  $ chectl commands [--json] [-h] [--hidden] [--tree] [--columns <value> | -x] [--filter <value>] [--no-header
    | [--csv | --no-truncate]] [--output csv|json|yaml |  | ] [--sort <value>]

FLAGS
  -h, --help         Show CLI help.
  -x, --extended     show extra columns
  --columns=<value>  only show provided columns (comma-separated)
  --csv              output is csv format [alias: --output=csv]
  --filter=<value>   filter property by partial string matching, ex: name=foo
  --hidden           show hidden commands
  --no-header        hide table header from output
  --no-truncate      do not truncate output to fit screen
  --output=<option>  output in a more machine friendly format
                     <options: csv|json|yaml>
  --sort=<value>     property to sort by (prepend '-' for descending)
  --tree             show tree of commands

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  list all the commands
```

_See code: [@oclif/plugin-commands](https://github.com/oclif/plugin-commands/blob/v3.0.7/src/commands/commands.ts)_

## `chectl help [COMMANDS]`

Display help for chectl.

```
USAGE
  $ chectl help [COMMANDS] [-n]

ARGUMENTS
  COMMANDS  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for chectl.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.0.7/src/commands/help.ts)_

## `chectl update [CHANNEL]`

update the chectl CLI

```
USAGE
  $ chectl update [CHANNEL] [--from-local]

FLAGS
  --from-local  interactively choose an already installed version

DESCRIPTION
  update the chectl CLI
```

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/v1.5.0/src/commands/update.ts)_

## `chectl version`

```
USAGE
  $ chectl version [--json] [--verbose]

FLAGS
  --verbose  Show additional information about the CLI.

GLOBAL FLAGS
  --json  Format output as json.

FLAG DESCRIPTIONS
  --verbose  Show additional information about the CLI.

    Additionally shows the architecture, node version, operating system, and versions of plugins that the CLI is using.
```

_See code: [@oclif/plugin-version](https://github.com/oclif/plugin-version/blob/v2.0.1/src/commands/version.ts)_
<!-- commandsstop -->


# Contributing

Contributing to chectl is covered in [CONTRIBUTING.md](https://github.com/che-incubator/chectl/blob/main/CONTRIBUTING.md)

# Builds

This repo contains several [actions](https://github.com/eclipse-che/che-operator/actions), including:
* [![release latest stable](https://github.com/che-incubator/chectl/actions/workflows/release.yml/badge.svg)](https://github.com/che-incubator/chectl/actions/workflows/release.yml)
* [![PR](https://github.com/che-incubator/chectl/actions/workflows/pr-check.yml/badge.svg)](https://github.com/che-incubator/chectl/actions/workflows/pr-check.yml)
* [![try in webIDE](https://github.com/che-incubator/chectl/actions/workflows/try-in-web-ide.yaml/badge.svg)](https://github.com/che-incubator/chectl/actions/workflows/try-in-web-ide.yaml)

Downstream builds can be found at the link below, which is _internal to Red Hat_. Stable builds can be found by replacing the 3.x with a specific version like 3.2.  

* [dsc_3.x](https://main-jenkins-csb-crwqe.apps.ocp-c1.prod.psi.redhat.com/job/DS_CI/job/dsc_3.x)

See also: 
* [operator_3.x](https://main-jenkins-csb-crwqe.apps.ocp-c1.prod.psi.redhat.com/job/DS_CI/job/operator_3.x/)
* [operator-bundle_3.x](https://main-jenkins-csb-crwqe.apps.ocp-c1.prod.psi.redhat.com/job/DS_CI/job/operator-bundle_3.x/)


# License

Eclipse Che® is open sourced under the Eclipse Public License 2.0.

# Trademark

"Che" is a trademark of the Eclipse Foundation.
