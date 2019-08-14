#
# Copyright (c) 2019 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Florent Benoit - Initial Implementation

# $CHANNEL="next"; Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://www.eclipse.org/che/chectl/win/'))

# Default channel if missing
If ([string]::IsNullOrEmpty($CHANNEL)) {
  $CHANNEL = 'stable'
}

# Check channels
If ($CHANNEL -ne "next" -And $CHANNEL -ne "stable") {
  Write-Host "Wrong channel. Only next or stable are valid values" -ForegroundColor Red
  break
}

function CreateWebClient {
param (
  [string]$url
 )
  $webClient = new-object System.Net.WebClient
  return $webClient
}

function DownloadContent {
param (
  [string]$url
 )
  $webClient = CreateWebClient $url
  return $webClient.DownloadString($url)
}

function ComputeDownloadLink() {
  return "https://che-incubator.github.io/chectl/download-link/next-win32-x64"
}

function DownloadFile {
param (
  [string]$url,
  [string]$file
 )
  Write-Output "Downloading $url to $file"
  $webClient = CreateWebClient $url
  $webClient.DownloadFile($url, $file)
}

Function DeGZip-File{
    Param(
        $infile,
        $outfile = ($infile -replace '\.gz$','')
        )
    $input = New-Object System.IO.FileStream $inFile, ([IO.FileMode]::Open), ([IO.FileAccess]::Read), ([IO.FileShare]::Read)
    $output = New-Object System.IO.FileStream $outFile, ([IO.FileMode]::Create), ([IO.FileAccess]::Write), ([IO.FileShare]::None)
    $gzipStream = New-Object System.IO.Compression.GzipStream $input, ([IO.Compression.CompressionMode]::Decompress)
    $buffer = New-Object byte[](1024)
    while($true){
        $read = $gzipstream.Read($buffer, 0, 1024)
        if ($read -le 0){break}
        $output.Write($buffer, 0, $read)
        }
    $gzipStream.Close()
    $output.Close()
    $input.Close()
}

# Grab link to install chectl
$urlContent = computeDownloadLink
$finalLink = DownloadContent $urlContent

# Create temporary directory for chectl
$chectlTmpDir = Join-Path $env:TEMP "chectl"
$cheTmpFile = Join-Path $chectlTmpDir "chectl-tmp.tgz"
if (![System.IO.Directory]::Exists($chectlTmpDir)) {[void][System.IO.Directory]::CreateDirectory($chectlTmpDir)}

# Download the file to the tmp folder
DownloadFile $finalLink $cheTmpFile

# gunzip...
$gunzippedfile = Join-Path $chectlTmpDir "chectl-tmp.tar"
DeGZip-File $cheTmpFile $gunzippedfile

$chectlPath = "$env:SYSTEMDRIVE\ProgramData\chectl"
if (![System.IO.Directory]::Exists($chectlPath)) {[void][System.IO.Directory]::CreateDirectory($chectlPath)}

cd $chectlPath
Write-Output "Extracting chectl to $chectlPath..."
$argumentList ="-xf $gunzippedfile"
Start-Process -FilePath "tar.Exe" -NoNewWindow -Wait -RedirectStandardError "./NUL" -ArgumentList $argumentList 

# delete chectl temp directory
Remove-Item -LiteralPath $chectlTmpDir -Force -Recurse

$chectlInstalledFolderPath = Join-Path $chectlPath 'chectl'
$chectlBinFolderPath = Join-Path $chectlInstalledFolderPath 'bin'

# Add into path the chectl bin folder for the user
if ($($env:Path).ToLower().Contains($($chectlBinFolderPath).ToLower()) -eq $false) {
  $currentPath = [Environment]::GetEnvironmentVariable('Path',[System.EnvironmentVariableTarget]::User);
  $newPath = "$currentPath;$chectlBinFolderPath";
  [System.Environment]::SetEnvironmentVariable('Path',$newPath,[System.EnvironmentVariableTarget]::User);
  $env:Path = $newPath;
}


# launch chectl
chectl

Write-Host "chectl has been successfully installed" -ForegroundColor Green
