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
* [`chectl cacert:export`](#chectl-cacertexport)
* [`chectl commands`](#chectl-commands)
* [`chectl dashboard:open`](#chectl-dashboardopen)
* [`chectl help [COMMANDS]`](#chectl-help-commands)
* [`chectl server:debug`](#chectl-serverdebug)
* [`chectl server:delete`](#chectl-serverdelete)
* [`chectl server:deploy`](#chectl-serverdeploy)
* [`chectl server:logs`](#chectl-serverlogs)
* [`chectl server:start`](#chectl-serverstart)
* [`chectl server:status`](#chectl-serverstatus)
* [`chectl server:stop`](#chectl-serverstop)
* [`chectl server:update`](#chectl-serverupdate)
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

## `chectl cacert:export`

Retrieves Eclipse Che self-signed certificate

```
USAGE
  $ chectl cacert:export [-h] [-n <value>] [--telemetry on|off] [-d <value>]

FLAGS
  -d, --destination=<value>
      Destination where to store Eclipse Che self-signed CA certificate.
      If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
      If the destination is a directory, then cheCA.crt file will be created there with Eclipse Che certificate in PEM
      format.
      If this option is omitted, then Eclipse Che certificate will be stored in a user's temporary directory as cheCA.crt.

  -h, --help
      Show CLI help.

  -n, --chenamespace=<value>
      Eclipse Che Kubernetes namespace.

  --telemetry=<option>
      Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
      <options: on|off>

DESCRIPTION
  Retrieves Eclipse Che self-signed certificate
```

_See code: [src/commands/cacert/export.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/cacert/export.ts)_

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

## `chectl dashboard:open`

Open Eclipse Che dashboard

```
USAGE
  $ chectl dashboard:open [-h] [-n <value>] [--telemetry on|off]

FLAGS
  -h, --help                  Show CLI help.
  -n, --chenamespace=<value>  Eclipse Che Kubernetes namespace.
  --telemetry=<option>        Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                              <options: on|off>

DESCRIPTION
  Open Eclipse Che dashboard
```

_See code: [src/commands/dashboard/open.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/dashboard/open.ts)_

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

## `chectl server:debug`

Enable local debug of Eclipse Che server

```
USAGE
  $ chectl server:debug [-h] [--debug-port <value>] [-n <value>] [--telemetry on|off]
    [--skip-kubernetes-health-check]

FLAGS
  -h, --help                      Show CLI help.
  -n, --chenamespace=<value>      Eclipse Che Kubernetes namespace.
  --debug-port=<value>            [default: 8000] Eclipse Che server debug port
  --skip-kubernetes-health-check  Skip Kubernetes health check
  --telemetry=<option>            Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                                  <options: on|off>

DESCRIPTION
  Enable local debug of Eclipse Che server
```

_See code: [src/commands/server/debug.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/debug.ts)_

## `chectl server:delete`

delete any Eclipse Che related resource

```
USAGE
  $ chectl server:delete [-h] [-n <value>] [--delete-all] [--delete-namespace] [--telemetry on|off]
    [--skip-kubernetes-health-check] [-y | --batch]

FLAGS
  -h, --help                      Show CLI help.
  -n, --chenamespace=<value>      Eclipse Che Kubernetes namespace.
  -y, --yes                       Automatic yes to prompts; assume "yes" as answer to all prompts and run
                                  non-interactively
  --batch                         Batch mode. Running a command without end user interaction.
  --delete-all                    Indicates to delete Eclipse Che and Dev Workspace related resources
  --delete-namespace              Indicates that a Eclipse Che namespace will be deleted as well
  --skip-kubernetes-health-check  Skip Kubernetes health check
  --telemetry=<option>            Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                                  <options: on|off>

DESCRIPTION
  delete any Eclipse Che related resource
```

_See code: [src/commands/server/delete.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/delete.ts)_

## `chectl server:deploy`

Deploy Eclipse Che server

```
USAGE
  $ chectl server:deploy [-h] [-n <value>] [--batch] [-i <value>] [-t <value>] [--devfile-registry-url <value>]
    [--plugin-registry-url <value>] [--k8spodwaittimeout <value>] [--k8spodreadytimeout <value>]
    [--k8spoddownloadimagetimeout <value>] [--k8spoderrorrechecktimeout <value>] [-d <value>] [-p
    minikube|k8s|openshift|microk8s|docker-desktop|crc] [-b <value>] [--debug] [--che-operator-image <value>]
    [--che-operator-cr-yaml <value>] [--che-operator-cr-patch-yaml <value>] [--workspace-pvc-storage-class-name <value>]
    [--skip-version-check] [--skip-cert-manager] [--skip-devworkspace-operator] [--auto-update] [--starting-csv <value>]
    [--package-manifest-name <value>] [--catalog-source-yaml <value> --olm-channel <value>] [--catalog-source-name
    <value> --catalog-source-namespace <value> ] [--catalog-source-image <value> ] [--cluster-monitoring] [--telemetry
    on|off] [--skip-kubernetes-health-check]

FLAGS
  -b, --domain=<value>
      Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)
      This flag makes sense only for Kubernetes family infrastructures and will be autodetected for Minikube and MicroK8s
      in most cases.
      However, for Kubernetes cluster it is required to specify.
      Please note, that just setting this flag will not likely work out of the box.
      According changes should be done in Kubernetes cluster configuration as well.
      In case of Openshift, domain adjustment should be done on the cluster configuration level.

  -d, --directory=<value>
      Directory to store logs into

  -h, --help
      Show CLI help.

  -i, --cheimage=<value>
      Eclipse Che server container image

  -n, --chenamespace=<value>
      Eclipse Che Kubernetes namespace.

  -p, --platform=<option>
      Type of Kubernetes platform.
      <options: minikube|k8s|openshift|microk8s|docker-desktop|crc>

  -t, --templates=<value>
      Path to the templates folder

  --[no-]auto-update
      Auto update approval strategy for installation Eclipse Che.
      With this strategy will be provided auto-update Eclipse Che without any human interaction.
      By default this flag is enabled.

  --batch
      Batch mode. Running a command without end user interaction.

  --catalog-source-image=<value>
      OLM catalog source image or index bundle (IIB) from which to install the Eclipse Che operator.

  --catalog-source-name=<value>
      Name of the OLM catalog source or index bundle (IIB) from which to install Eclipse Che operator.

  --catalog-source-namespace=<value>
      Namespace for OLM catalog source to install Eclipse Che operator.

  --catalog-source-yaml=<value>
      Path to a yaml file that describes custom catalog source for installation Eclipse Che operator.
      Catalog source will be applied to the namespace with Eclipse Che operator.
      Also you need define 'olm-channel' name and 'package-manifest-name'.

  --che-operator-cr-patch-yaml=<value>
      Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used
      only when the installer is the 'operator' or the 'olm'.

  --che-operator-cr-yaml=<value>
      Path to a yaml file that defines a CheCluster used by the operator.

  --che-operator-image=<value>
      Container image of the operator.

  --cluster-monitoring
      Enable cluster monitoring to scrape Eclipse Che metrics in Prometheus.
      This parameter is used only when the platform is 'openshift'.

  --debug
      'Enables the debug mode for Eclipse Che server. To debug Eclipse Che server from localhost use 'server:debug'
      command.'

  --devfile-registry-url=<value>
      The URL of the external Devfile registry.

  --k8spoddownloadimagetimeout=<value>
      [default: 1200000] Waiting time for Pod downloading image (in milliseconds)

  --k8spoderrorrechecktimeout=<value>
      [default: 60000] Waiting time for Pod rechecking error (in milliseconds)

  --k8spodreadytimeout=<value>
      [default: 60000] Waiting time for Pod Ready condition (in milliseconds)

  --k8spodwaittimeout=<value>
      [default: 60000] Waiting time for Pod scheduled condition (in milliseconds)

  --olm-channel=<value>
      Olm channel to install Eclipse Che, f.e. stable.
      If options was not set, will be used default version for package manifest.

  --package-manifest-name=<value>
      Package manifest name to subscribe to Eclipse Che OLM package manifest.

  --plugin-registry-url=<value>
      The URL of the external plugin registry.

  --skip-cert-manager
      Skip installing Cert Manager (Kubernetes cluster only).

  --skip-devworkspace-operator
      Skip installing Dev Workspace Operator.

  --skip-kubernetes-health-check
      Skip Kubernetes health check

  --skip-version-check
      Skip minimal versions check.

  --starting-csv=<value>
      Starting cluster service version(CSV) for installation Eclipse Che.
      Flags uses to set up start installation version Che.
      For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
      Then OLM will install Eclipse Che with version 7.10.0.
      Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known
      version.

  --telemetry=<option>
      Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
      <options: on|off>

  --workspace-pvc-storage-class-name=<value>
      persistent volume(s) storage class name to use to store Eclipse Che workspaces data

DESCRIPTION
  Deploy Eclipse Che server
```

_See code: [src/commands/server/deploy.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/deploy.ts)_

## `chectl server:logs`

Collect Eclipse Che logs

```
USAGE
  $ chectl server:logs [-h] [-d <value>] [-n <value>] [--telemetry on|off] [--skip-kubernetes-health-check]

FLAGS
  -d, --directory=<value>         Directory to store logs into
  -h, --help                      Show CLI help.
  -n, --chenamespace=<value>      Eclipse Che Kubernetes namespace.
  --skip-kubernetes-health-check  Skip Kubernetes health check
  --telemetry=<option>            Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                                  <options: on|off>

DESCRIPTION
  Collect Eclipse Che logs
```

_See code: [src/commands/server/logs.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/logs.ts)_

## `chectl server:start`

Start Eclipse Che server

```
USAGE
  $ chectl server:start [-h] [-n <value>] [--telemetry on|off] [--skip-kubernetes-health-check] [--batch]
    [--k8spodwaittimeout <value>] [--k8spodreadytimeout <value>] [--k8spoddownloadimagetimeout <value>]
    [--k8spoderrorrechecktimeout <value>] [-d <value>]

FLAGS
  -d, --directory=<value>               Directory to store logs into
  -h, --help                            Show CLI help.
  -n, --chenamespace=<value>            Eclipse Che Kubernetes namespace.
  --batch                               Batch mode. Running a command without end user interaction.
  --k8spoddownloadimagetimeout=<value>  [default: 1200000] Waiting time for Pod downloading image (in milliseconds)
  --k8spoderrorrechecktimeout=<value>   [default: 60000] Waiting time for Pod rechecking error (in milliseconds)
  --k8spodreadytimeout=<value>          [default: 60000] Waiting time for Pod Ready condition (in milliseconds)
  --k8spodwaittimeout=<value>           [default: 60000] Waiting time for Pod scheduled condition (in milliseconds)
  --skip-kubernetes-health-check        Skip Kubernetes health check
  --telemetry=<option>                  Enable or disable telemetry. This flag skips a prompt and enable/disable
                                        telemetry
                                        <options: on|off>

DESCRIPTION
  Start Eclipse Che server
```

_See code: [src/commands/server/start.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/start.ts)_

## `chectl server:status`

Status Eclipse Che server

```
USAGE
  $ chectl server:status [-h] [-n <value>] [--telemetry on|off]

FLAGS
  -h, --help                  Show CLI help.
  -n, --chenamespace=<value>  Eclipse Che Kubernetes namespace.
  --telemetry=<option>        Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                              <options: on|off>

DESCRIPTION
  Status Eclipse Che server
```

_See code: [src/commands/server/status.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/status.ts)_

## `chectl server:stop`

stop Eclipse Che server

```
USAGE
  $ chectl server:stop [-h] [-n <value>] [--telemetry on|off] [--skip-kubernetes-health-check]

FLAGS
  -h, --help                      Show CLI help.
  -n, --chenamespace=<value>      Eclipse Che Kubernetes namespace.
  --skip-kubernetes-health-check  Skip Kubernetes health check
  --telemetry=<option>            Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
                                  <options: on|off>

DESCRIPTION
  stop Eclipse Che server
```

_See code: [src/commands/server/stop.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/stop.ts)_

## `chectl server:update`

Update Eclipse Che server.

```
USAGE
  $ chectl server:update [-h] [-n <value>] [-y | --batch] [-t <value>] [--che-operator-image <value>]
    [--che-operator-cr-patch-yaml <value>] [--skip-devworkspace-operator] [--skip-kubernetes-health-check]
    [--skip-version-check] [--telemetry on|off] [--package-manifest-name <value>] [--catalog-source-namespace <value>
    --catalog-source-name <value> --olm-channel <value>] [--catalog-source-yaml <value> ] [--catalog-source-image
    <value> ] [--auto-update] [--starting-csv <value>]

FLAGS
  -h, --help
      Show CLI help.

  -n, --chenamespace=<value>
      Eclipse Che Kubernetes namespace.

  -t, --templates=<value>
      Path to the templates folder

  -y, --yes
      Automatic yes to prompts; assume "yes" as answer to all prompts and run non-interactively

  --[no-]auto-update
      Auto update approval strategy for installation Eclipse Che.
      With this strategy will be provided auto-update Eclipse Che without any human interaction.
      By default this flag is enabled.

  --batch
      Batch mode. Running a command without end user interaction.

  --catalog-source-image=<value>
      OLM catalog source image or index bundle (IIB) from which to install the Eclipse Che operator.

  --catalog-source-name=<value>
      Name of the OLM catalog source or index bundle (IIB) from which to install Eclipse Che operator.

  --catalog-source-namespace=<value>
      Namespace for OLM catalog source to install Eclipse Che operator.

  --catalog-source-yaml=<value>
      Path to a yaml file that describes custom catalog source for installation Eclipse Che operator.
      Catalog source will be applied to the namespace with Eclipse Che operator.
      Also you need define 'olm-channel' name and 'package-manifest-name'.

  --che-operator-cr-patch-yaml=<value>
      Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used
      only when the installer is the 'operator' or the 'olm'.

  --che-operator-image=<value>
      Container image of the operator.

  --olm-channel=<value>
      Olm channel to install Eclipse Che, f.e. stable.
      If options was not set, will be used default version for package manifest.

  --package-manifest-name=<value>
      Package manifest name to subscribe to Eclipse Che OLM package manifest.

  --skip-devworkspace-operator
      Skip installing Dev Workspace Operator.

  --skip-kubernetes-health-check
      Skip Kubernetes health check

  --skip-version-check
      Skip minimal versions check.

  --starting-csv=<value>
      Starting cluster service version(CSV) for installation Eclipse Che.
      Flags uses to set up start installation version Che.
      For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
      Then OLM will install Eclipse Che with version 7.10.0.
      Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known
      version.

  --telemetry=<option>
      Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
      <options: on|off>

DESCRIPTION
  Update Eclipse Che server.

EXAMPLES
  # Update Eclipse Che:

    $ chectl server:update

  # Update Eclipse Che in 'eclipse-che' namespace:

    $ chectl server:update -n eclipse-che

  # Update Eclipse Che and update its configuration in the custom resource:

    $ chectl server:update --che-operator-cr-patch-yaml patch.yaml

  # Update Eclipse Che from the provided channel:

    $ chectl server:update --olm-channel next

  # Update Eclipse Che from the provided CatalogSource and channel:

    $ chectl server:update --olm-channel fast --catalog-source-name MyCatalogName --catalog-source-namespace \
      MyCatalogNamespace

  # Create CatalogSource based on provided image and update Eclipse Che from it:

    $ chectl server:update --olm-channel latest --catalog-source-image MyCatalogImage

  # Create a CatalogSource defined in yaml file and update Eclipse Che from it:

    $ chectl server:update --olm-channel stable --catalog-source-yaml PATH_TO_CATALOG_SOURCE_YAML
```

_See code: [src/commands/server/update.ts](https://github.com/che-incubator/chectl/blob/v7.91.0/src/commands/server/update.ts)_

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
