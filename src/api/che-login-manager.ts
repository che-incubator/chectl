/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import axios, { AxiosInstance } from 'axios'
import * as fs from 'fs-extra'
import * as https from 'https'
import * as path from 'path'
import * as querystring from 'querystring'

import { ACCESS_TOKEN_KEY } from '../common-flags'
import { findWorkingNamespace } from '../util'

import { CheHelper } from './che'
import { CheApiClient } from './che-api-client'
import { ChectlContext } from './context'
import { KubeHelper } from './kube'

// Represents login information to use for requests
// Notice: accessToken is undefined for single user mode
export interface LoginData {
  cheApiEndpoint: string
  accessToken: string | undefined
}

// Credentials file format
export interface CheServerLoginConfig {
  // Defines file format version
  version?: string
  // Define current login session. Empty if none.
  lastLoginUrl?: string
  lastUserName?: string
  // Registered logins
  logins?: Logins
}

// API URL -> logins into server
export type Logins = { [key: string]: ServerLogins }
// username -> login data
export type ServerLogins = { [key: string]: RefreshTokenLoginRecord }
export type LoginRecord = RefreshTokenLoginRecord | PasswordLoginRecord | OcUserTokenLoginRecord

export interface RefreshTokenLoginRecord {
  refreshToken: string
  // Expiration datetime (in seconds) for local timezone
  expires: number
}

export interface OcUserTokenLoginRecord {
  subjectToken: string
  subjectIssuer: string
}

export interface PasswordLoginRecord {
  username: string
  password: string
}

export function isRefreshTokenLoginData(loginData: LoginRecord): loginData is RefreshTokenLoginRecord {
  return !!(loginData as RefreshTokenLoginRecord).refreshToken
}

export function isOcUserTokenLoginData(loginData: LoginRecord): loginData is OcUserTokenLoginRecord {
  return !!(loginData as OcUserTokenLoginRecord).subjectToken
}

export function isPasswordLoginData(loginData: LoginRecord): loginData is PasswordLoginRecord {
  return !!(loginData as PasswordLoginRecord).password
}

// Response structure from <che-host>/api/keycloak/settings
interface CheKeycloakSettings {
  'che.keycloak.logout.endpoint': string
  'che.keycloak.jwks.endpoint': string
  'che.keycloak.token.endpoint': string
  'che.keycloak.userinfo.endpoint': string
  'che.keycloak.client_id': string
  'che.keycloak.username_claim': string
  'che.keycloak.js_adapter_url': string
  'che.keycloak.use_nonce': string

  'che.keycloak.profile.endpoint'?: string
  'che.keycloak.auth_server_url'?: string
  'che.keycloak.password.endpoint'?: string
  'che.keycloak.realm'?: string

  'che.keycloak.oidc_provider'?: string
  'che.keycloak.github.endpoint'?: string
}

// Response structure from Keycloak get access token endpoint
interface KeycloakAuthTokenResponse {
  access_token: string
  expires_in: number | string
  refresh_token: string
  refresh_expires_in?: number | string
  token_type: string
  scope?: string
}

const REQUEST_TIMEOUT_MS = 10000
const LOGIN_DATA_FILE_NAME = 'che-login-config.json'

let loginContext: CheServerLoginManager | undefined
/**
 * Che server login sessions manager. Singleton.
 * Uses refresh tokens for authentication.
 * Usually, just using of getLoginData function is suitable.
 */
export class CheServerLoginManager {
  private loginData: CheServerLoginConfig
  private apiUrl: string
  private username: string

  private readonly dataFilePath: string
  private readonly axios: AxiosInstance

  private constructor(dataFilePath: string) {
    this.dataFilePath = dataFilePath

    this.loginData = {}
    this.readLoginData()
    this.apiUrl = this.loginData.lastLoginUrl || ''
    this.username = this.loginData.lastUserName || ''

    // Remove outdated login records
    this.removeExpiredLogins()

    // Make axios ignore untrusted certificate error for self-signed certificate case.
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })
    this.axios = axios.create({
      httpsAgent
    })
  }

  /**
   * Returns Che server login sessions manager.
   */
  static async getInstance(): Promise<CheServerLoginManager> {
    const ctx = ChectlContext.get()
    const configDir = ctx[ChectlContext.CONFIG_DIR]

    if (!fs.existsSync(configDir)) {
      fs.mkdirsSync(configDir)
    }
    const dataFilePath = path.join(configDir, LOGIN_DATA_FILE_NAME)
    if (loginContext && loginContext.dataFilePath === dataFilePath) {
      return loginContext
    }

    loginContext = new CheServerLoginManager(dataFilePath)
    return loginContext
  }

  /**
   * Checks whether login credentials exists for given server and user.
   * @param apiUrl API URL of the Che server
   * @param username username
   */
  public hasLoginFor(apiUrl: string, username?: string): boolean {
    apiUrl = CheApiClient.normalizeCheApiEndpointUrl(apiUrl)
    if (username) {
      return !!this.getLoginRecord(apiUrl, username)
    } else {
      return !!this.loginData.logins![apiUrl]
    }
  }

  public getCurrentLoginInfo(): { cheApiEndpoint: string, username: string } {
    return { cheApiEndpoint: this.apiUrl, username: this.username }
  }

  public getCurrentServerApiUrl(): string {
    return this.apiUrl
  }

  public getAllLogins(): Map<string, string[]> {
    this.removeExpiredLogins()

    const allLogins = new Map<string, string[]>()
    for (const [apiUrl, serverLogins] of Object.entries(this.loginData.logins!)) {
      allLogins.set(apiUrl, Array.from(Object.keys(serverLogins)))
    }
    return allLogins
  }

  /**
   * Logins user in specified instance of Che Server.
   * Makes this login data default context.
   * If a context with the same data already exists it will be replaced.
   * If provided data is invalid, exception will be thrown.
   * Returns username of the login.
   * @param apiUrl Che server API URL
   * @param loginRecord user credentials
   */
  public async setLoginContext(apiUrl: string, loginRecord: LoginRecord): Promise<string> {
    apiUrl = CheApiClient.normalizeCheApiEndpointUrl(apiUrl)
    const cheKeycloakSettings = await this.retrieveKeycloakSettings(apiUrl)

    // Check whether provided login credentials valid and get refresh token.
    const keycloakAuthData = await this.keycloakAuth(apiUrl, loginRecord, cheKeycloakSettings)
    const now = (Date.now() / 1000)
    let refreshTokenExpiresIn: string | number = keycloakAuthData.refresh_expires_in ? keycloakAuthData.refresh_expires_in : keycloakAuthData.expires_in
    if (typeof refreshTokenExpiresIn === 'string') {
      refreshTokenExpiresIn = parseFloat(refreshTokenExpiresIn)
    }
    const refreshTokenLoginRecord: RefreshTokenLoginRecord = {
      refreshToken: keycloakAuthData.refresh_token,
      expires: now + refreshTokenExpiresIn
    }

    const username = isPasswordLoginData(loginRecord) ? loginRecord.username :
      await this.getCurrentUserName(cheKeycloakSettings, keycloakAuthData.access_token)

    // Delete outdated logins as config file will be rewritten
    this.removeExpiredLogins()

    // Credentials are valid, make them current
    this.setCurrentLoginContext(apiUrl, username, refreshTokenLoginRecord)
    // Save changes permanently
    this.saveLoginData()
    return username
  }

  /**
   * Changes current login.
   */
  public async switchLoginContext(apiUrl: string, username: string): Promise<void> {
    // Get rid of outdated credentials before trying to switch current login
    this.removeExpiredLogins()

    apiUrl = CheApiClient.normalizeCheApiEndpointUrl(apiUrl)
    const loginRecord = this.getLoginRecord(apiUrl, username)
    if (!loginRecord) {
      throw new Error(`User "${username}" is not logged in on "${apiUrl}" server`)
    }

    // Ensure the server is reachable and credentials are still valid
    const keycloakAuthData = await this.keycloakAuth(apiUrl, loginRecord)
    // Update refresh token
    loginRecord.refreshToken = keycloakAuthData.refresh_token

    this.setCurrentLoginContext(apiUrl, username, loginRecord)
    this.saveLoginData()
  }

  /**
   * Logouts user from specified Che server.
   * If no parameters given current login session will be deleted.
   * @param apiUrl Che server API URL
   * @param username username on the given server
   */
  public deleteLoginContext(apiUrl?: string, username?: string): void {
    if (!this.loginData.logins) {
      return
    }

    if (!apiUrl) {
      if (!this.apiUrl) {
        // Not logged in
        return
      }
      // Delete current login context
      return this.deleteLoginContext(this.apiUrl, this.username)
    }

    apiUrl = CheApiClient.normalizeCheApiEndpointUrl(apiUrl)

    if (!username) {
      // Delete all logins on the server
      delete this.loginData.logins![apiUrl]
    } else {
      // Delete specific login record if any
      const serverLogins = this.loginData.logins[apiUrl]
      if (!serverLogins) {
        // No logins for specified server
        return
      }
      delete serverLogins[username]
      if (Object.keys(serverLogins).length < 1) {
        // Delete server without logins
        delete this.loginData.logins[apiUrl]
      }
    }

    if (apiUrl === this.apiUrl) {
      // Current login info should be deleted
      this.loginData.lastLoginUrl = this.apiUrl = ''
      this.loginData.lastUserName = this.username = ''
    }
    this.removeExpiredLogins()
    this.saveLoginData()
  }

  private readLoginData(): void {
    if (fs.existsSync(this.dataFilePath)) {
      this.loginData = JSON.parse(fs.readFileSync(this.dataFilePath).toString()) as CheServerLoginConfig
    } else {
      this.loginData = {}
    }

    if (!this.loginData.logins) {
      this.loginData.logins = {}
    }

    if (!this.loginData.version) {
      // So far there is only one existing file format
      this.loginData.version = 'v1'
    }
  }

  private saveLoginData(): void {
    this.loginData.lastLoginUrl = this.apiUrl
    this.loginData.lastUserName = this.username
    fs.writeFileSync(this.dataFilePath, JSON.stringify(this.loginData))
  }

  /**
   * Searches for login data by API URL and user name.
   * Returns undefined if nothing found by given keys.
   */
  private getLoginRecord(apiUrl: string, username: string): RefreshTokenLoginRecord | undefined {
    const serverLogins = this.loginData.logins![apiUrl]
    if (!serverLogins) {
      return
    }
    return serverLogins[username]
  }

  /**
   * Sets current login credentials by given API URL and username.
   * If loginRecord is provided, then a new credentials are added, replacing existing if any.
   * This method doesn't check credentials validity.
   * Returns true if operation was successful.
   */
  private setCurrentLoginContext(apiUrl: string, username: string, loginRecord?: RefreshTokenLoginRecord): boolean {
    if (!loginRecord) {
      // Find existing login context and make current
      loginRecord = this.getLoginRecord(apiUrl, username)
      if (!loginRecord) {
        return false
      }
    } else {
      // Set given login config as current
      let serverLogins = this.loginData.logins![apiUrl]
      if (!serverLogins) {
        serverLogins = {}
        this.loginData.logins![apiUrl] = serverLogins
      }
      serverLogins[username] = loginRecord
    }

    this.apiUrl = apiUrl
    this.username = username
    return true
  }

  private removeExpiredLogins(): void {
    if (!this.loginData.logins) {
      return
    }

    const now = Date.now() / 1000
    for (const [apiUrl, serverLogins] of Object.entries(this.loginData.logins)) {
      for (const [username, loginRecord] of Object.entries(serverLogins)) {
        if (loginRecord.expires <= now) {
          // Token is expired, delete it
          delete serverLogins[username]
        }
      }
      if (Object.keys(serverLogins).length < 1) {
        // Delete server without logins
        delete this.loginData.logins[apiUrl]
      }
    }

    // Check if current login is still present
    if (!this.getLoginRecord(this.apiUrl, this.username)) {
      this.loginData.lastLoginUrl = this.apiUrl = ''
      this.loginData.lastUserName = this.username = ''
    }
  }

  private async retrieveKeycloakSettings(apiUrl: string): Promise<CheKeycloakSettings> {
    const cheApi = CheApiClient.getInstance(apiUrl)
    const keycloakSettings = await cheApi.getKeycloakSettings()
    if (!keycloakSettings) {
      // Single user mode
      throw new Error(`Authentication is not supported on the server: "${apiUrl}"`)
    }
    return keycloakSettings
  }

  /**
   * Returns new Keycloak access token for current login session.
   * Updates session timeout.
   */
  public async getNewAccessToken(): Promise<string> {
    if (!this.apiUrl || !this.username) {
      throw new Error('Login context is not set. Please login first.')
    }

    const loginRecord = this.getLoginRecord(this.apiUrl, this.username)
    if (!loginRecord) {
      // Should never happen
      throw new Error('Invalid login state')
    }

    const keycloakAuthData = await this.keycloakAuth(this.apiUrl, loginRecord)
    // Update refresh token
    loginRecord.refreshToken = keycloakAuthData.refresh_token
    this.removeExpiredLogins()
    this.setCurrentLoginContext(this.apiUrl, this.username, loginRecord)
    this.saveLoginData()

    return keycloakAuthData.access_token
  }

  private async keycloakAuth(apiUrl: string, loginRecord: LoginRecord, cheKeycloakSettings?: CheKeycloakSettings): Promise<KeycloakAuthTokenResponse> {
    if (!cheKeycloakSettings) {
      cheKeycloakSettings = await this.retrieveKeycloakSettings(apiUrl)
    }
    if (isPasswordLoginData(loginRecord)) {
      return this.getKeycloakAuthDataByUserNameAndPassword(cheKeycloakSettings, loginRecord.username, loginRecord.password)
    } else {
      if (isRefreshTokenLoginData(loginRecord)) {
        return this.getKeycloakAuthDataByRefreshToken(cheKeycloakSettings, loginRecord.refreshToken)
      } else if (isOcUserTokenLoginData(loginRecord)) {
        return this.getKeycloakAuthDataByOcToken(cheKeycloakSettings, loginRecord.subjectToken, loginRecord.subjectIssuer)
      } else {
        // Should never happen
        throw new Error('Token is not provided')
      }
    }
  }

  private async getKeycloakAuthDataByUserNameAndPassword(cheKeycloakSettings: CheKeycloakSettings, username: string, password: string): Promise<KeycloakAuthTokenResponse> {
    const keycloakTokenUrl = cheKeycloakSettings['che.keycloak.token.endpoint']
    const data = {
      client_id: cheKeycloakSettings['che.keycloak.client_id'],
      grant_type: 'password',
      username,
      password,
    }
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
    try {
      const response = await this.axios.post(keycloakTokenUrl, querystring.stringify(data), { headers, timeout: REQUEST_TIMEOUT_MS })
      if (!response || response.status !== 200 || !response.data) {
        throw new Error('E_BAD_RESP_KEYCLOAK')
      }
      return response.data
    } catch (error) {
      let message = error.message
      if (error && error.response && error.response.data && error.response.data.error_description) {
        message = error.response.data.error_description
      }
      throw new Error(`Failed to get access token from ${keycloakTokenUrl}. Cause: ${message}`)
    }
  }

  private async getKeycloakAuthDataByRefreshToken(cheKeycloakSettings: CheKeycloakSettings, refreshToken: string): Promise<KeycloakAuthTokenResponse> {
    const data = {
      client_id: cheKeycloakSettings['che.keycloak.client_id'],
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }
    return this.requestKeycloakAuth(cheKeycloakSettings['che.keycloak.token.endpoint'], data)
  }

  private async getKeycloakAuthDataByOcToken(cheKeycloakSettings: CheKeycloakSettings, subjectToken: string, subjectIssuer: string): Promise<KeycloakAuthTokenResponse> {
    const data = {
      client_id: cheKeycloakSettings['che.keycloak.client_id'],
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_issuer: subjectIssuer,
    }
    return this.requestKeycloakAuth(cheKeycloakSettings['che.keycloak.token.endpoint'], data)
  }

  private async requestKeycloakAuth(keycloakTokenUrl: string, requestData: any): Promise<KeycloakAuthTokenResponse> {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
    try {
      const response = await this.axios.post(keycloakTokenUrl, querystring.stringify(requestData), { headers, timeout: REQUEST_TIMEOUT_MS })
      if (!response || response.status !== 200 || !response.data) {
        throw new Error('E_BAD_RESP_KEYCLOAK')
      }
      return response.data
    } catch (error) {
      let message = error.message
      if (error && error.response && error.response.data && error.response.data.error_description) {
        message = error.response.data.error_description
      }
      throw new Error(`Failed to get the access token from ${keycloakTokenUrl}. Cause: ${message}`)
    }
  }

  private async getCurrentUserName(cheKeycloakSettings: CheKeycloakSettings, accessToken: string): Promise<string> {
    const endpoint = cheKeycloakSettings['che.keycloak.userinfo.endpoint']
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `bearer ${accessToken}`,
    }
    try {
      const response = await this.axios.get(endpoint, { headers, timeout: REQUEST_TIMEOUT_MS })
      if (!response || response.status !== 200 || !response.data) {
        throw new Error('E_BAD_RESP_KEYCLOAK')
      }
      return response.data.preferred_username
    } catch (error) {
      throw new Error(`Failed to get userdata from ${endpoint}. Cause: ${error.message}`)
    }
  }

}

/**
 * Helper function to get valid credentials. Designed to be used from commands.
 * @param cheApiEndpoint user provided server API URL if any
 * @param accessToken user provied access token if any
 */
export async function getLoginData(cheApiEndpoint: string, accessToken: string | undefined, flags: any): Promise<LoginData> {
  if (cheApiEndpoint) {
    // User provides credential manually
    const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
    await cheApiClient.checkCheApiEndpointUrl()
    if (!accessToken && await cheApiClient.isAuthenticationEnabled()) {
      throw new Error(`Parameter "--${ACCESS_TOKEN_KEY}" is expected.`)
    }
    // Single user mode, proceed without token
  } else {
    if (accessToken !== undefined) {
      throw new Error('Eclipse Che server API endpoint is required. Use \'--che-api-endpoint\' to provide it.')
    }

    // Use login manager to get Che API URL and token
    const loginManager = await CheServerLoginManager.getInstance()
    cheApiEndpoint = loginManager.getCurrentServerApiUrl()
    if (!cheApiEndpoint) {
      cheApiEndpoint = await getCheApiEndpoint(flags)
      const cheApiClient = CheApiClient.getInstance(cheApiEndpoint)
      if (await cheApiClient.isAuthenticationEnabled()) {
        throw new Error('There is no active login session. Please use "auth:login" first.')
      } else {
        return { cheApiEndpoint, accessToken }
      }
    }
    accessToken = await loginManager.getNewAccessToken()
  }
  return { cheApiEndpoint, accessToken }
}

/**
 * Gets cheApiEndpoint for the given namespace.
 */
export async function getCheApiEndpoint(flags: any): Promise<string> {
  const kube = new KubeHelper(flags)
  const namespace = await findWorkingNamespace(flags)
  if (!await kube.hasReadPermissionsForNamespace(namespace)) {
    throw new Error('Please provide server API URL argument')
  }

  // Retrieve API URL from routes
  const cheHelper = new CheHelper(flags)
  return await cheHelper.cheURL(namespace) + '/api'
}
