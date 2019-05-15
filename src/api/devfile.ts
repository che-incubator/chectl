// Generated automatically via quicktype.io
/**
 * This schema describes the structure of the devfile object
 */
export interface Devfile {
  attributes?: { [key: string]: string }
  /**
   * Description of the predefined commands to be available in workspace
   */
  commands?: DevfileCommand[]
  /**
   * Description of the workspace components, such as editor and plugins
   */
  components?: DevfileComponent[]
  /**
   * The name of the devfile. Workspaces created from devfile, will inherit this name
   */
  name: string
  /**
   * Description of the projects, containing names and sources locations
   */
  projects?: DevfileProject[]
  specVersion: string
}

export interface DevfileCommand {
  /**
   * List of the actions of given command. Now the only one command must be specified in list
   * but there are plans to implement supporting multiple actions commands.
   */
  actions: CommandAction[]
  /**
   * Additional command attributes
   */
  attributes?: { [key: string]: string }
  /**
   * Describes the name of the command. Should be unique per commands set.
   */
  name: string
}

export interface CommandAction {
  /**
   * The actual action command-line string
   */
  command: string
  /**
   * Describes component to which given action relates
   */
  component: string
  /**
   * Describes action type
   */
  type: string
  /**
   * Working directory where the command should be executed
   */
  workdir?: string
}

export interface DevfileComponent {
  /**
   * The arguments to supply to the command running the dockerimage component. The arguments
   * are supplied either to the default command provided in the image or to the overridden
   * command. Defaults to null, meaning use whatever is defined in the image.
   */
  args?: string[]
  /**
   * The command to run in the dockerimage component instead of the default one provided in
   * the image. Defaults to null, meaning use whatever is defined in the image.
   */
  command?: string[]
  /**
   * Describes dockerimage component endpoints
   */
  endpoints?: Array<any[] | boolean | number | number | null | EndpointObject | string>
  entrypoints?: Entrypoint[]
  /**
   * The environment variables list that should be set to docker container
   */
  env?: Env[]
  /**
   * Describes the component id. It has the following format: [{REGISTRY_URL}/]{plugin/editor
   * ID}:{plugin/editor VERSION}, where `{REGISTRY_URL}/` is an optional part.
   */
  id?: string
  /**
   * Specifies the docker image that should be used for component
   */
  image?: string
  /**
   * Describes memory limit for the component. You can express memory as a plain integer or as
   * a fixed-point integer using one of these suffixes: E, P, T, G, M, K. You can also use the
   * power-of-two equivalents: Ei, Pi, Ti, Gi, Mi, Ki
   */
  memoryLimit?: string
  /**
   * Describes whether projects sources should be mount to the component. `CHE_PROJECTS_ROOT`
   * environment variable should contains a path where projects sources are mount
   */
  mountSources?: boolean
  /**
   * Describes the alias of the component. Should be unique per components set.
   */
  alias: string
  /**
   * Describes absolute or devfile-relative location of Kubernetes list yaml file. Applicable
   * only for 'kubernetes' and 'openshift' type components
   */
  reference?: string
  /**
   * Inlined content of a file specified in field 'reference'
   */
  referenceContent?: string
  /**
   * Describes the objects selector for the recipe type components. Allows to pick-up only
   * selected items from k8s/openshift list
   */
  selector?: { [key: string]: string }
  /**
   * Describes type of the component, e.g. whether it is an plugin or editor or other type
   */
  type: TheEndpointName
  /**
   * Describes volumes which should be mount to component
   */
  volumes?: Volume[]
}

export interface EndpointObject {
  attributes?: { [key: string]: string }
  /**
   * The Endpoint name
   */
  name: string
  /**
   * The container port that should be used as endpoint
   */
  port: number
}

export interface Entrypoint {
  /**
   * The arguments to supply to the command running the component. The arguments are supplied
   * either to the default command provided in the image of the container or to the overridden
   * command. Defaults to null, meaning use whatever is defined in the image.
   */
  args?: string[]
  /**
   * The command to run in the component instead of the default one provided in the image of
   * the container. Defaults to null, meaning use whatever is defined in the image.
   */
  command?: string[]
  /**
   * The name of the container to apply the entrypoint to. If not specified, the entrypoint is
   * modified on all matching containers.
   */
  containerName?: string
  /**
   * The name of the top level object in the referenced object list in which to search for
   * containers. If not specified, the objects to search through can have any name.
   */
  parentName?: string
  /**
   * The selector on labels of the top level objects in the referenced list in which to search
   * for containers. If not specified, the objects to search through can have any labels.
   */
  parentSelector?: { [key: string]: string }
}

/**
 * Describes environment variable
 */
export interface Env {
  /**
   * The environment variable name
   */
  name: string
  /**
   * The environment variable value
   */
  value: string
}

export enum TheEndpointName {
  CheEditor = 'cheEditor',
  ChePlugin = 'chePlugin',
  Dockerimage = 'dockerimage',
  Kubernetes = 'kubernetes',
  Openshift = 'openshift',
}

/**
 * Describe volume that should be mount to component
 */
export interface Volume {
  containerPath: string
  /**
   * The volume name. If several components mount the same volume then they will reuse the
   * volume and will be able to access to the same files
   */
  name: string
}

export interface DevfileProject {
  /**
   * The path relative to the root of the projects to which this project should be cloned
   * into. This is a unix-style relative path (i.e. uses forward slashes). The path is invalid
   * if it is absolute or tries to escape the project root through the usage of '..'. If not
   * specified, defaults to the project name.
   */
  clonePath?: string
  name: string
  /**
   * Describes the project's source - type and location
   */
  source: ProjectSource
}

/**
 * Describes the project's source - type and location
 */
export interface ProjectSource {
  /**
   * The name of the of the branch to check out after obtaining the source from the location.
   * The branch has to already exist in the source otherwise the default branch is used. In
   * case of git, this is also the name of the remote branch to push to.
   */
  branch?: string
  /**
   * The id of the commit to reset the checked out branch to. Note that this is equivalent to
   * 'startPoint' and provided for convenience.
   */
  commitId?: string
  /**
   * Project's source location address. Should be URL for git and github located projects, or
   * file:// for zip.
   */
  location: string
  /**
   * The tag or commit id to reset the checked out branch to.
   */
  startPoint?: string
  /**
   * The name of the tag to reset the checked out branch to. Note that this is equivalent to
   * 'startPoint' and provided for convenience.
   */
  tag?: string
  /**
   * Project's source type.
   */
  type: string
}
