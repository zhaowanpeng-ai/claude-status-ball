#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Server,
    [int]$SshPort = 22,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$ballVbs = Join-Path $repo 'app\start_ball.vbs'
$tunnelVbs = Join-Path $PSScriptRoot 'start_tunnel.vbs'
$configDir = Join-Path $env:USERPROFILE '.claude-ball'
$config = Join-Path $configDir 'tunnel.conf'

if (-not (Test-Path -LiteralPath $ballVbs)) {
    throw "Missing file: $ballVbs"
}
if (-not $LocalOnly -and -not (Test-Path -LiteralPath $tunnelVbs)) {
    throw "Missing file: $tunnelVbs"
}

if (-not $LocalOnly -and -not (Test-Path -LiteralPath $config)) {
    if (-not $Server) {
        $Server = Read-Host 'SSH destination (for example root@1.2.3.4 or myserver)'
    }
    if (-not $Server) {
        throw 'SERVER is required.'
    }

    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    @"
SERVER=$Server
SSH_PORT=$SshPort
REMOTE_PORT=47831
LOCAL_PORT=47831
SSH_EXE=
"@ | Set-Content -LiteralPath $config -Encoding ASCII
    Write-Host "Created $config"
}

$startup = [Environment]::GetFolderPath('Startup')
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell

function New-StartupShortcut {
    param(
        [string]$Name,
        [string]$Script
    )

    $path = Join-Path $startup $Name
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $wscript
    $shortcut.Arguments = '"' + $Script + '"'
    $shortcut.WorkingDirectory = Split-Path -Parent $Script
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Claude Status Ball'
    $shortcut.Save()
    Write-Host "Created $path"
}

New-StartupShortcut -Name 'Claude Status Ball.lnk' -Script $ballVbs
if (-not $LocalOnly) {
    New-StartupShortcut -Name 'Claude Status Ball Tunnel.lnk' -Script $tunnelVbs
}

Write-Host ''
Write-Host 'Startup shortcuts installed.'
Write-Host 'Start them now with:'
Write-Host "  wscript.exe `"$ballVbs`""
if (-not $LocalOnly) {
    Write-Host "  wscript.exe `"$tunnelVbs`""
}
