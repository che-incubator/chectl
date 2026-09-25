/**
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

// https://github.com/redhat-developer/devspaces-remote-ssh/blob/main/src/utils/io.ts

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import * as path from 'path'
import { PortForwardInfo } from './cluster'
import SSHConfig, { LineType } from 'ssh-config'
import { extStoragePath } from '../constants'

export function readFile(filePath: string): string {
    let content = ''
    try {
        content = readFileSync(filePath, 'utf8')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
        // continue
    }
    return content
}

export function writeKeyFile(fileName: string, data: string): string {
    return writeSecret(fileName, data, '.ssh')
}

export function writeContextFile(fileName: string, data: string): string {
    return writeSecret(fileName, data, '.k8s')
}

export function writeSecret(fileName: string, data: string, folderName: string): string {
    const privateKeyDir = path.join(extStoragePath, folderName)
    ensureExists(privateKeyDir)
    const privateKeyPath = path.join(privateKeyDir, fileName)
    writeFileSync(privateKeyPath, data, { mode: 0o600 })
    return privateKeyPath
}

export function rememberPorts(portForwardEntries: PortForwardInfo[]) {
    const portFile = path.join(extStoragePath, 'ports')
    ensureExists(extStoragePath)
    const portDataJson: PortForwardInfo[] = []
    for (const pf of portForwardEntries) {
        portDataJson.push(pf)
    }
    const updatedPortData = JSON.stringify(portDataJson)
    writeFileSync(portFile, updatedPortData, { mode: 0o600 })
}

export function getSavedPorts(): PortForwardInfo[] {
    const portFile = path.join(extStoragePath, 'ports')
    const portData = readFile(portFile)
    let portDataJson: PortForwardInfo[] = []
    try {
        portDataJson = JSON.parse(portData)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
        // continue
    }
    return portDataJson
}

export function deleteDirectory(dir: string) {
    if (existsSync(dir)) {
        readdirSync(dir).forEach(child => {
            const entry = path.join(dir, child)
            if (lstatSync(entry).isDirectory()) {
                deleteDirectory(entry)
            } else {
                unlinkSync(entry)
            }
        })
        rmdirSync(dir)
    }
}

export function ensureExists(dir: string) {
    if (existsSync(dir)) {
        return
    }
    ensureExists(path.dirname(dir))
    mkdirSync(dir)
}

export function ensureWorkspaceConfigIncluded(sshConfigFile: string, clusterConfigFile: string) {
    const sshData = readFile(sshConfigFile)
    const sshConfig = SSHConfig.parse(sshData)

    let count = 0
    for (const line of sshConfig) {
        if (line.type === LineType.DIRECTIVE &&
            line.param === 'Include' &&
            typeof line.value === 'string' &&
            line.value === 'cluster.conf') {
            count++
        }
        if (line.type === LineType.DIRECTIVE &&
            line.param === 'Include' &&
            typeof line.value === 'string' &&
            line.value.includes('cluster.conf') &&
            path.isAbsolute(line.value)) {
            count++
        }
    }

    // Workaround for https://github.com/PowerShell/Win32-OpenSSH/issues/1511
    if (count < 2) {
        sshConfig.prepend({
            Include: 'cluster.conf',
        })
        if (count === 0) {
            sshConfig.prepend({
                Include: `${clusterConfigFile}`,
            })
        }
    }

    const newSSHData = SSHConfig.stringify(sshConfig)
    writeFileSync(sshConfigFile, newSSHData, { mode: 0o600 })
}
