chectl
======

[Eclipse Che](https://github.com/eclipse/che/) CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![codecov](https://codecov.io/gh/che-incubator/chectl/branch/main/graph/badge.svg?token=ZBQtKMeiYu)](https://codecov.io/gh/che-incubator/chectl)

[![asciicast](https://asciinema.org/a/216201.svg)](https://asciinema.org/a/216201)

## Report issues

Issues are tracked on the main Eclipse Che Repository: https://github.com/eclipse/che/issues

[![New questions](https://img.shields.io/badge/New-question-blue.svg?style=flat-curved)](https://github.com/eclipse/che/issues/new?labels=area/chectl,kind/question)
[![New bug](https://img.shields.io/badge/New-bug-red.svg?style=flat-curved)](https://github.com/eclipse/che/issues/new?labels=area/chectl,kind/bug)

## Table Of Contents

<!-- toc -->
* [Installation](#installation)
* [Usage](#usage)
* [Commands](#commands)
* [Contributing](#contributing)
<!-- tocstop -->
# Installation

There are two channels of `chectl`: `stable` and `next`

Stable is for all tagged versions of Eclipse Che. Next is updated after each commit/Pull Request being merged in main branch of the [Chectl repository](https://github.com/che-incubator/chectl).

If you're using Windows x64, here is how to install chectl by using one single PowerShell command:

- For `stable` channel:
```
C:\Users> Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://www.eclipse.org/che/chectl/win/'))
```

- For `next` channel:
```
C:\Users> $CHANNEL="next"; Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://www.eclipse.org/che/chectl/win/'))
```

If you're using linux or macOS, here is how to install chectl by using one single command:

- For `stable` channel:
```
$ bash <(curl -sL  https://www.eclipse.org/che/chectl/)
```

- For `next` channel:
```
$ bash <(curl -sL  https://www.eclipse.org/che/chectl/) --channel=next
```

Assemblies of chectl are available at [https://github.com/che-incubator/chectl/releases](https://github.com/che-incubator/chectl/releases)

Manual install:

1) Download a .tgz file based on your Operating System / Arch
2) Unpack the assembly
3) Move `chectl` folder into a folder like `$HOME/chectl`
4) Add alias `alias chectl=$HOME/chectl/bin/run`

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
* [`chectl dashboard:open`](#chectl-dashboardopen)
* [`chectl help [COMMAND]`](#chectl-help-command)
* [`chectl server:debug`](#chectl-serverdebug)
* [`chectl server:delete`](#chectl-serverdelete)
* [`chectl server:deploy`](#chectl-serverdeploy)
* [`chectl server:logs`](#chectl-serverlogs)
* [`chectl server:start`](#chectl-serverstart)
* [`chectl server:status`](#chectl-serverstatus)
* [`chectl server:stop`](#chectl-serverstop)
* [`chectl server:update`](#chectl-serverupdate)
* [`chectl update [CHANNEL]`](#chectl-update-channel)

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

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v1.1.1/src/commands/autocomplete/index.ts)_

## `chectl cacert:export`

Retrieves Eclipse Che self-signed certificate

```
USAGE
  $ chectl cacert:export

OPTIONS
  -d, --destination=destination
      Destination where to store Che self-signed CA certificate.
      If the destination is a file (might not exist), then the certificate will be saved there in PEM format.
      If the destination is a directory, then cheCA.crt file will be created there with Che certificate in PEM format.
      If this option is omitted, then Che certificate will be stored in a user's temporary directory as cheCA.crt.

  -h, --help
      show CLI help

  -n, --chenamespace=chenamespace
      Eclipse Che Kubernetes namespace. Default to 'eclipse-che'

  --skip-kubernetes-health-check
      Skip Kubernetes health check

  --telemetry=on|off
      Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/cacert/export.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/cacert/export.ts)_

## `chectl dashboard:open`

Open Eclipse Che dashboard

```
USAGE
  $ chectl dashboard:open

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  --telemetry=on|off               Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/dashboard/open.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/dashboard/open.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.18/src/commands/help.ts)_

## `chectl server:debug`

Enable local debug of Eclipse Che server

```
USAGE
  $ chectl server:debug

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  --debug-port=debug-port          [default: 8000] Eclipse Che server debug port
  --skip-kubernetes-health-check   Skip Kubernetes health check
  --telemetry=on|off               Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/server/debug.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/debug.ts)_

## `chectl server:delete`

delete any Eclipse Che related resource: Kubernetes/OpenShift

```
USAGE
  $ chectl server:delete

OPTIONS
  -h, --help                         show CLI help
  -n, --chenamespace=chenamespace    Eclipse Che Kubernetes namespace. Default to 'eclipse-che'

  -y, --yes                          Automatic yes to prompts; assume "yes" as answer to all prompts and run
                                     non-interactively

  --batch                            Batch mode. Running a command without end user interaction.

  --delete-namespace                 Indicates that a Eclipse Che namespace will be deleted as well

  --deployment-name=deployment-name  [default: che] Eclipse Che deployment name

  --skip-kubernetes-health-check     Skip Kubernetes health check

  --telemetry=on|off                 Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/server/delete.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/delete.ts)_

## `chectl server:deploy`

Deploy Eclipse Che server

```
USAGE
  $ chectl server:deploy

OPTIONS
  -a, --installer=operator|olm
      Installer type. If not set, default is "olm" for OpenShift 4.x platform otherwise "operator".

  -b, --domain=domain
      Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)
      This flag makes sense only for Kubernetes family infrastructures and will be autodetected for Minikube and MicroK8s
      in most cases.
      However, for Kubernetes cluster it is required to specify.
      Please note, that just setting this flag will not likely work out of the box.
      According changes should be done in Kubernetes cluster configuration as well.
      In case of Openshift, domain adjustment should be done on the cluster configuration level.

  -d, --directory=directory
      Directory to store logs into

  -h, --help
      show CLI help

  -i, --cheimage=cheimage
      Eclipse Che server container image

  -n, --chenamespace=chenamespace
      Eclipse Che Kubernetes namespace. Default to 'eclipse-che'

  -o, --cheboottimeout=cheboottimeout
      (required) [default: 40000] Eclipse Che server bootstrap timeout (in milliseconds)

  -p, --platform=minikube|minishift|k8s|openshift|microk8s|docker-desktop|crc
      Type of Kubernetes platform. Valid values are "minikube", "minishift", "k8s (for kubernetes)", "openshift", "crc
      (for CodeReady Containers)", "microk8s".

  -t, --templates=templates
      Path to the templates folder

  -v, --version=version
      Version to deploy (e.g. 7.15.2). Defaults to the same as chectl.

  --[no-]auto-update
      Auto update approval strategy for installation Eclipse Che.
      With this strategy will be provided auto-update Eclipse Che without any human interaction.
      By default this flag is enabled.
      This parameter is used only when the installer is 'olm'.

  --batch
      Batch mode. Running a command without end user interaction.

  --catalog-source-name=catalog-source-name
      OLM catalog source to install Eclipse Che operator.
      This parameter is used only when the installer is the 'olm'.

  --catalog-source-namespace=catalog-source-namespace
      Namespace for OLM catalog source to install Eclipse Che operator.
      This parameter is used only when the installer is the 'olm'.

  --catalog-source-yaml=catalog-source-yaml
      Path to a yaml file that describes custom catalog source for installation Eclipse Che operator.
      Catalog source will be applied to the namespace with Che operator.
      Also you need define 'olm-channel' name and 'package-manifest-name'.
      This parameter is used only when the installer is the 'olm'.

  --che-operator-cr-patch-yaml=che-operator-cr-patch-yaml
      Path to a yaml file that overrides the default values in CheCluster CR used by the operator. This parameter is used
      only when the installer is the 'operator' or the 'olm'.

  --che-operator-cr-yaml=che-operator-cr-yaml
      Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer
      is the 'operator' or the 'olm'.

  --che-operator-image=che-operator-image
      Container image of the operator. This parameter is used only when the installer is the operator or OLM.

  --debug
      Enables the debug mode for Eclipse Che server. To debug Eclipse Che server from localhost use 'server:debug'
      command.

  --deployment-name=deployment-name
      [default: che] Eclipse Che deployment name

  --devfile-registry-url=devfile-registry-url
      The URL of the external Devfile registry.

  --k8spoddownloadimagetimeout=k8spoddownloadimagetimeout
      [default: 600000] Waiting time for Pod downloading image (in milliseconds)

  --k8spoderrorrechecktimeout=k8spoderrorrechecktimeout
      [default: 60000] Waiting time for Pod rechecking error (in milliseconds)

  --k8spodreadytimeout=k8spodreadytimeout
      [default: 600000] Waiting time for Pod Ready condition (in milliseconds)

  --k8spodwaittimeout=k8spodwaittimeout
      [default: 600000] Waiting time for Pod scheduled condition (in milliseconds)

  --olm-channel=olm-channel
      Olm channel to install Eclipse Che, f.e. stable.
      If options was not set, will be used default version for package manifest.
      This parameter is used only when the installer is the 'olm'.

  --[no-]olm-suggested-namespace
      Indicate to deploy Eclipse Che in OLM suggested namespace: 'eclipse-che'.
      Flag 'chenamespace' is ignored in this case
      This parameter is used only when the installer is 'olm'.

  --package-manifest-name=package-manifest-name
      Package manifest name to subscribe to Eclipse Che OLM package manifest.
      This parameter is used only when the installer is the 'olm'.

  --plugin-registry-url=plugin-registry-url
      The URL of the external plugin registry.

  --postgres-pvc-storage-class-name=postgres-pvc-storage-class-name
      persistent volume storage class name to use to store Eclipse Che postgres database

  --skip-cluster-availability-check
      Skip cluster availability check. The check is a simple request to ensure the cluster is reachable.

  --skip-kubernetes-health-check
      Skip Kubernetes health check

  --skip-oidc-provider-check
      Skip OIDC Provider check

  --skip-version-check
      Skip minimal versions check.

  --starting-csv=starting-csv
      Starting cluster service version(CSV) for installation Eclipse Che.
      Flags uses to set up start installation version Che.
      For example: 'starting-csv' provided with value 'eclipse-che.v7.10.0' for stable channel.
      Then OLM will install Eclipse Che with version 7.10.0.
      Notice: this flag will be ignored with 'auto-update' flag. OLM with auto-update mode installs the latest known
      version.
      This parameter is used only when the installer is 'olm'.

  --telemetry=on|off
      Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry

  --workspace-pvc-storage-class-name=workspace-pvc-storage-class-name
      persistent volume(s) storage class name to use to store Eclipse Che workspaces data
```

_See code: [src/commands/server/deploy.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/deploy.ts)_

## `chectl server:logs`

Collect Eclipse Che logs

```
USAGE
  $ chectl server:logs

OPTIONS
  -d, --directory=directory          Directory to store logs into
  -h, --help                         show CLI help
  -n, --chenamespace=chenamespace    Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  --deployment-name=deployment-name  [default: che] Eclipse Che deployment name
  --skip-kubernetes-health-check     Skip Kubernetes health check
  --telemetry=on|off                 Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/server/logs.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/logs.ts)_

## `chectl server:start`

Start Eclipse Che server

```
USAGE
  $ chectl server:start

OPTIONS
  -d, --directory=directory                                Directory to store logs into
  -h, --help                                               show CLI help
  -n, --chenamespace=chenamespace                          Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  --batch                                                  Batch mode. Running a command without end user interaction.
  --deployment-name=deployment-name                        [default: che] Eclipse Che deployment name

  --k8spoddownloadimagetimeout=k8spoddownloadimagetimeout  [default: 600000] Waiting time for Pod downloading image (in
                                                           milliseconds)

  --k8spoderrorrechecktimeout=k8spoderrorrechecktimeout    [default: 60000] Waiting time for Pod rechecking error (in
                                                           milliseconds)

  --k8spodreadytimeout=k8spodreadytimeout                  [default: 600000] Waiting time for Pod Ready condition (in
                                                           milliseconds)

  --k8spodwaittimeout=k8spodwaittimeout                    [default: 600000] Waiting time for Pod scheduled condition
                                                           (in milliseconds)

  --skip-kubernetes-health-check                           Skip Kubernetes health check
```

_See code: [src/commands/server/start.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/start.ts)_

## `chectl server:status`

Status Eclipse Che server

```
USAGE
  $ chectl server:status

OPTIONS
  -h, --help                       show CLI help
  -n, --chenamespace=chenamespace  Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  --telemetry=on|off               Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/server/status.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/status.ts)_

## `chectl server:stop`

stop Eclipse Che server

```
USAGE
  $ chectl server:stop

OPTIONS
  -h, --help                         show CLI help
  -n, --chenamespace=chenamespace    Eclipse Che Kubernetes namespace. Default to 'eclipse-che'

  --access-token=access-token        Eclipse Che OIDC Access Token. See the documentation how to obtain token:
                                     https://www.eclipse.org/che/docs/che-7/administration-guide/authenticating-users/#o
                                     btaining-the-token-from-keycloak_authenticating-to-the-che-server and https://www.e
                                     clipse.org/che/docs/che-7/administration-guide/authenticating-users/#obtaining-the-
                                     token-from-openshift-token-through-keycloak_authenticating-to-the-che-server.

  --che-selector=che-selector        [default: app=che,component=che] Selector for Eclipse Che server resources

  --deployment-name=deployment-name  [default: che] Eclipse Che deployment name

  --skip-kubernetes-health-check     Skip Kubernetes health check

  --telemetry=on|off                 Enable or disable telemetry. This flag skips a prompt and enable/disable telemetry
```

_See code: [src/commands/server/stop.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/stop.ts)_

## `chectl server:update`

Update Eclipse Che server.

```
USAGE
  $ chectl server:update

OPTIONS
  -h, --help                                               show CLI help
  -n, --chenamespace=chenamespace                          Eclipse Che Kubernetes namespace. Default to 'eclipse-che'
  -t, --templates=templates                                Path to the templates folder

  -v, --version=version                                    Version to deploy (e.g. 7.15.2). Defaults to the same as
                                                           chectl.

  -y, --yes                                                Automatic yes to prompts; assume "yes" as answer to all
                                                           prompts and run non-interactively

  --batch                                                  Batch mode. Running a command without end user interaction.

  --che-operator-cr-patch-yaml=che-operator-cr-patch-yaml  Path to a yaml file that overrides the default values in
                                                           CheCluster CR used by the operator. This parameter is used
                                                           only when the installer is the 'operator' or the 'olm'.

  --deployment-name=deployment-name                        [default: che] Eclipse Che deployment name

  --skip-kubernetes-health-check                           Skip Kubernetes health check

  --telemetry=on|off                                       Enable or disable telemetry. This flag skips a prompt and
                                                           enable/disable telemetry

EXAMPLES
  # Update Eclipse Che:
  chectl server:update

  # Update Eclipse Che in 'eclipse-che' namespace:
  chectl server:update -n eclipse-che

  # Update Eclipse Che and update its configuration in the custom resource:
  chectl server:update --che-operator-cr-patch-yaml patch.yaml
```

_See code: [src/commands/server/update.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/update.ts)_

## `chectl update [CHANNEL]`

update the chectl CLI

```
USAGE
  $ chectl update [CHANNEL]

OPTIONS
  --from-local  interactively choose an already installed version
```

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/v1.5.0/src/commands/update.ts)_
<!-- commandsstop -->


# Contributing

Contributing to chectl is covered in [CONTRIBUTING.md](https://github.com/che-incubator/chectl/blob/main/CONTRIBUTING.md)
