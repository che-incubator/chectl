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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'path';

/*
 * macOS URL scheme registration.
 *
 * protocol-registry can't be used here. Its macOS backend shells out to chmod,
 * defaultAppExist.sh and `node plistMutator.js` with /snapshot paths, and
 * subprocesses can't see /snapshot once the CLI is packaged with pkg. The chmod
 * runs at import time, so it takes down every command, not just --init.
 */

const execFileAsync = promisify(execFile);

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

/** Asks Launch Services which app owns a scheme. */
const DEFAULT_APP_SCRIPT = `#!/usr/bin/osascript

use AppleScript version "2.4"
use framework "Foundation"
use framework "AppKit"

on run argv
    set appFile to my getDefautltAppFor(item 1 of argv)

    if appFile = missing value then
        set output to "pr-result=false"
    else
        set output to (the POSIX path of appFile) as text
    end if

    output
end run

on getDefautltAppFor(theProto)
\tset theWorkspace to current application's NSWorkspace's sharedWorkspace()
\tset defaultAppURL to theWorkspace's URLForApplicationToOpenURL:(current application's |NSURL|'s URLWithString:theProto)
\tif defaultAppURL = missing value then return missing value
\treturn defaultAppURL as «class furl»
end getDefautltAppFor
`;

export interface RegisterOptions {
    appName: string;
    terminal?: boolean;  // Ignored on macOS (we always use Terminal.app)
    override?: boolean;  // Ignored on macOS (we always overwrite)
}

function handlerDir(): string {
    return path.join(homedir(), '.devspaces-cli-connector', 'url-handler');
}

function bundleIdentifier(protocol: string): string {
    return `com.redhat.devspaces.urlhandler.${protocol}`;
}

/** Domain used to pass the URL to the terminal launcher. */
function defaultsDomain(protocol: string): string {
    return `com.redhat.devspaces.${protocol}`;
}

/** Path of the app registered for the scheme, or undefined if unclaimed. */
export async function getDefaultApp(protocol: string): Promise<string | undefined> {
    const scriptDir = mkdtempSync(path.join(tmpdir(), `devspaces-${protocol}-`));
    const scriptPath = path.join(scriptDir, 'defaultAppExist.applescript');
    try {
        writeFileSync(scriptPath, DEFAULT_APP_SCRIPT, { mode: 0o700 });
        const { stdout } = await execFileAsync('osascript', [scriptPath, `${protocol}://test`]);
        const result = stdout.trim();
        return result === 'pr-result=false' ? undefined : result;
    } finally {
        rmSync(scriptDir, { recursive: true, force: true });
    }
}

export async function checkIfExists(protocol: string): Promise<boolean> {
    return await getDefaultApp(protocol) !== undefined;
}

/** Builds an AppleScript app that forwards the URL to the given command. */
export async function register(protocol: string, command: string, options: RegisterOptions): Promise<void> {
    const appDir = handlerDir();
    mkdirSync(appDir, { recursive: true });

    const launcherPath = path.join(appDir, `${protocol}-launch.sh`);
    const terminalAppPath = path.join(appDir, `DevSpaces Terminal Launcher.app`);
    const urlAppPath = path.join(appDir, `${options.appName}.app`);

    // The URL arrives as $1 so the command can keep its own quoting.
    writeFileSync(launcherPath, `#!/usr/bin/env bash\n_URL_=$1\n${command}\n`, { mode: 0o755 });

    // Use 'quoted form of' to safely shell-escape the URL (CWE-78 mitigation).
    const launchCommand = `'${launcherPath}' " & quoted form of this_URL & "`;

    // `on open location` can't drive Terminal itself, so stash the URL in
    // defaults and let a second app read it back.
    await compileApp(terminalAppPath, [
        `set this_URL to do shell script "defaults read ${defaultsDomain(protocol)} current_url"`,
        `tell application "Terminal"`,
        `    set command to "${launchCommand}"`,
        `    do script command`,
        `    activate`,
        `end tell`,
    ].join('\n'));

    await compileApp(urlAppPath, [
        `on open location this_URL`,
        `    do shell script "defaults write ${defaultsDomain(protocol)} current_url " & quoted form of this_URL`,
        `    tell application "${terminalAppPath}" to activate`,
        `end open location`,
    ].join('\n'));

    await declareUrlScheme(urlAppPath, protocol);

    // Launching it is what makes Launch Services pick it up.
    await execFileAsync('open', ['-g', '-W', urlAppPath]);
}

/** Removes the handler app, if we created it. */
export async function deRegister(protocol: string, defaultApp: string): Promise<void> {
    const { stdout } = await execFileAsync(PLIST_BUDDY, [
        '-c', 'Print :CFBundleIdentifier',
        path.join(defaultApp, 'Contents', 'Info.plist'),
    ]);

    if (stdout.trim() !== bundleIdentifier(protocol)) {
        throw new Error(`${defaultApp} already handles ${protocol}:// and was not registered by this CLI.`);
    }

    rmSync(defaultApp, { recursive: true, force: true });
}

async function compileApp(appPath: string, source: string): Promise<void> {
    const sourceDir = mkdtempSync(path.join(tmpdir(), 'devspaces-osacompile-'));
    const sourcePath = path.join(sourceDir, 'app.applescript');
    try {
        writeFileSync(sourcePath, source);
        // osacompile refuses to overwrite an existing bundle.
        rmSync(appPath, { recursive: true, force: true });
        await execFileAsync('osacompile', ['-o', appPath, sourcePath]);
    } finally {
        rmSync(sourceDir, { recursive: true, force: true });
    }
}

async function declareUrlScheme(appPath: string, protocol: string): Promise<void> {
    const plistFile = path.join(appPath, 'Contents', 'Info.plist');
    // osacompile emits no CFBundleIdentifier, and the app is rebuilt each
    // time, so Add works throughout and Set doesn't.
    await execFileAsync(PLIST_BUDDY, [
        '-c', `Add :CFBundleIdentifier string ${bundleIdentifier(protocol)}`,
        '-c', 'Add :CFBundleURLTypes array',
        '-c', 'Add :CFBundleURLTypes:0 dict',
        '-c', `Add :CFBundleURLTypes:0:CFBundleURLName string URL : ${protocol}`,
        '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
        '-c', `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${protocol}`,
        plistFile,
    ]);
}

/**
 * Export a protocol-registry-compatible interface.
 * This allows the macOS implementation to be a drop-in replacement
 * for the protocol-registry module.
 */
export default {
    checkIfExists,
    getDefaultApp,
    register,
    deRegister,
};
