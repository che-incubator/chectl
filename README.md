chectl
======

[Eclipse Che](https://github.com/eclipse/che/) CLI

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Build Status](https://travis-ci.org/che-incubator/chectl.svg?branch=master)](https://travis-ci.org/che-incubator/chectl)
![](https://img.shields.io/david/che-incubator/chectl.svg)

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

Stable is for all tagged versions of Eclipse Che. Next is updated after each commit/Pull Request being merged in master branch of the [Chectl repository](https://github.com/che-incubator/chectl).

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
3) move `chectl` folder into a folder like `$HOME/chectl`
4) add `$HOME/chectl/bin` to `$PATH``

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
* [`chectl devfile:generate`](#chectl-devfilegenerate)
* [`chectl help [COMMAND]`](#chectl-help-command)
* [`chectl server:delete`](#chectl-serverdelete)
* [`chectl server:logs`](#chectl-serverlogs)
* [`chectl server:start`](#chectl-serverstart)
* [`chectl server:stop`](#chectl-serverstop)
* [`chectl server:update`](#chectl-serverupdate)
* [`chectl update [CHANNEL]`](#chectl-update-channel)
* [`chectl workspace:inject`](#chectl-workspaceinject)
* [`chectl workspace:list`](#chectl-workspacelist)
* [`chectl workspace:logs`](#chectl-workspacelogs)
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

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v0.1.4/src/commands/autocomplete/index.ts)_

## `chectl devfile:generate`

generate and print a devfile to stdout given some Kubernetes resources and other Che workspaces features (project, language-support, commands etc...)

```
USAGE
  $ chectl devfile:generate

OPTIONS
  -h, --help                 show CLI help
  --command=command          Command to include in the workspace
  --dockerimage=dockerimage  dockerimage component to include in the Devfile
  --editor=editor            Specify the Che editor component. Currently supported editors: theia-next,theia-1.0.0
  --git-repo=git-repo        Source code git repository to include in the workspace

  --language=language        Add support for a particular language. Currently supported languages:
                             java,typescript,go,python,c#

  --name=name                Workspace name

  --namespace=namespace      Kubernetes namespace where the resources are defined

  --plugin=plugin            Che plugin to include in the workspace. The format is JSON. For example this is a valid Che
                             Plugin specification: {"type": "TheEndpointName.ChePlugin", "alias": "java-ls", "id":
                             "redhat/java/0.38.0"}

  --selector=selector        label selector to filter the Kubernetes resources. For example
                             --selector="app.kubernetes.io/name=employee-manager"
```

_See code: [src/commands/devfile/generate.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/devfile/generate.ts)_

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.2.1/src/commands/help.ts)_

## `chectl server:delete`

delete any Che related resource: Kubernetes/OpenShift/Helm

```
USAGE
  $ chectl server:delete

OPTIONS
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/server/delete.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/delete.ts)_

## `chectl server:logs`

Retrieve Eclipse Che logs

```
USAGE
  $ chectl server:logs

OPTIONS
  -d, --directory=directory                [default: ./logs] Directory to store logs into
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  --deployment-name=deployment-name        [default: che] Che deployment name

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/server/logs.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/logs.ts)_

## `chectl server:start`

start Eclipse Che Server

```
USAGE
  $ chectl server:start

OPTIONS
  -a, --installer=helm|operator|minishift-addon
      Installer type

  -b, --domain=domain
      Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)

  -d, --directory=directory
      [default: ./logs] Directory to store logs into

  -h, --help
      show CLI help

  -i, --cheimage=cheimage
      [default: eclipse/che-server:nightly] Che server container image

  -m, --multiuser
      Starts che in multi-user mode

  -n, --chenamespace=chenamespace
      [default: che] Kubernetes namespace where Che server is supposed to be deployed

  -o, --cheboottimeout=cheboottimeout
      (required) [default: 40000] Che server bootstrap timeout (in milliseconds)

  -p, --platform=minikube|minishift|k8s|openshift|microk8s|docker-desktop|crc
      Type of Kubernetes platform. Valid values are "minikube", "minishift", "k8s (for kubernetes)", "openshift", "crc 
      (for CodeReady Containers)", "microk8s".

  -s, --tls
      Enable TLS encryption.
                           Note that for kubernetes 'che-tls' with TLS certificate must be created in the configured 
      namespace.
                           For OpenShift, router will use default cluster certificates.

  -t, --templates=templates
      [default: templates] Path to the templates folder

  --che-operator-cr-yaml=che-operator-cr-yaml
      Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer 
      is the operator.

  --che-operator-image=che-operator-image
      [default: quay.io/eclipse/che-operator:nightly] Container image of the operator. This parameter is used only when 
      the installer is the operator

  --deployment-name=deployment-name
      [default: che] Che deployment name

  --devfile-registry-url=devfile-registry-url
      The URL of the external Devfile registry.

  --k8spodreadytimeout=k8spodreadytimeout
      [default: 130000] Waiting time for Pod Ready Kubernetes (in milliseconds)

  --k8spodwaittimeout=k8spodwaittimeout
      [default: 300000] Waiting time for Pod Wait Timeout Kubernetes (in milliseconds)

  --listr-renderer=default|silent|verbose
      [default: default] Listr renderer

  --os-oauth
      Enable use of OpenShift credentials to log into Che

  --plugin-registry-url=plugin-registry-url
      The URL of the external plugin registry.

  --self-signed-cert
      Authorize usage of self signed certificates for encryption. Note that `self-signed-cert` secret with CA certificate 
      must be created in the configured namespace.
```

_See code: [src/commands/server/start.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/start.ts)_

## `chectl server:stop`

stop Eclipse Che Server

```
USAGE
  $ chectl server:stop

OPTIONS
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  --access-token=access-token              Che OIDC Access Token

  --che-selector=che-selector              [default: app=che,component=che] Selector for Che Server resources

  --deployment-name=deployment-name        [default: che] Che deployment name

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/server/stop.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/stop.ts)_

## `chectl server:update`

update Eclipse Che Server

```
USAGE
  $ chectl server:update

OPTIONS
  -a, --installer=helm|operator|minishift-addon                                Installer type
  -h, --help                                                                   show CLI help

  -n, --chenamespace=chenamespace                                              [default: che] Kubernetes namespace where
                                                                               Che server is supposed to be deployed

  -p, --platform=minikube|minishift|k8s|openshift|microk8s|docker-desktop|crc  Type of Kubernetes platform. Valid values
                                                                               are "minikube", "minishift", "k8s (for
                                                                               kubernetes)", "openshift", "crc (for
                                                                               CodeReady Containers)", "microk8s".

  -t, --templates=templates                                                    [default: templates] Path to the
                                                                               templates folder

  --che-operator-image=che-operator-image                                      [default:
                                                                               quay.io/eclipse/che-operator:nightly]
                                                                               Container image of the operator. This
                                                                               parameter is used only when the installer
                                                                               is the operator

  --deployment-name=deployment-name                                            [default: che] Che deployment name

  --listr-renderer=default|silent|verbose                                      [default: default] Listr renderer

  --skip-version-check                                                         Skip user confirmation on version check
```

_See code: [src/commands/server/update.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/server/update.ts)_

## `chectl update [CHANNEL]`

update the chectl CLI

```
USAGE
  $ chectl update [CHANNEL]
```

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/v1.3.9/src/commands/update.ts)_

## `chectl workspace:inject`

inject configurations and tokens in a Che Workspace

```
USAGE
  $ chectl workspace:inject

OPTIONS
  -c, --container=container                Target container. If not specified, configuration files will be injected in
                                           all containers of a Che Workspace pod

  -h, --help                               show CLI help

  -k, --kubeconfig                         Inject the local Kubernetes configuration

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  -w, --workspace=workspace                Target workspace. Can be omitted if only one Workspace is running

  --kube-context=kube-context              Kubeconfig context to inject

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/workspace/inject.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/inject.ts)_

## `chectl workspace:list`

list Che workspaces

```
USAGE
  $ chectl workspace:list

OPTIONS
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  --access-token=access-token              Che OIDC Access Token

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/workspace/list.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/list.ts)_

## `chectl workspace:logs`

Retrieve workspace logs

```
USAGE
  $ chectl workspace:logs

OPTIONS
  -d, --directory=directory                [default: ./logs] Directory to store logs into
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  -w, --workspace=workspace                Target workspace. Can be omitted if only one Workspace is running

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/workspace/logs.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/logs.ts)_

## `chectl workspace:start`

create and start a Che workspace

```
USAGE
  $ chectl workspace:start

OPTIONS
  -d, --directory=directory                [default: ./logs] Directory to store logs into
  -f, --devfile=devfile                    path or URL to a valid devfile
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  -w, --workspaceconfig=workspaceconfig    path to a valid workspace configuration json file

  --access-token=access-token              Che OIDC Access Token

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer

  --name=name                              workspace name: overrides the workspace name to use instead of the one
                                           defined in the devfile. Works only for devfile
```

_See code: [src/commands/workspace/start.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/start.ts)_

## `chectl workspace:stop`

stop a running Che workspace

```
USAGE
  $ chectl workspace:stop

OPTIONS
  -h, --help                               show CLI help

  -n, --chenamespace=chenamespace          [default: che] Kubernetes namespace where Che server is supposed to be
                                           deployed

  --access-token=access-token              Che OIDC Access Token

  --listr-renderer=default|silent|verbose  [default: default] Listr renderer
```

_See code: [src/commands/workspace/stop.ts](https://github.com/che-incubator/chectl/blob/v0.0.2/src/commands/workspace/stop.ts)_
<!-- commandsstop -->


# Contributing

Contributing to chectl is covered in [CONTRIBUTING.md](https://github.com/che-incubator/chectl/blob/master/CONTRIBUTING.md)
