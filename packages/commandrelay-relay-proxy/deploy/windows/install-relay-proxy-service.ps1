param(
  [string]$ServiceName = "CommandRelayRelayProxy",
  [string]$ServiceDisplayName = "CommandRelay Relay Proxy",
  [string]$Description = "CommandRelay WebSocket relay sidecar",
  [string]$PackageRoot = "",
  [string]$EnvFile = "",
  [bool]$StartImmediately = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path "HKLM:\SYSTEM\CurrentControlSet\Services\")) {
  Write-Error "Run this script in an elevated PowerShell session."
  exit 1
}

if (-not $PackageRoot) {
  $PackageRoot = Split-Path -Path $PSScriptRoot -Parent
}

$resolvedPackageRoot = (Resolve-Path -Path $PackageRoot).Path
$runner = Join-Path -Path $resolvedPackageRoot -ChildPath "deploy\\windows\\run-relay-proxy-service.ps1"
if (-not (Test-Path -Path $runner -PathType Leaf)) {
  Write-Error "Runner script not found: $runner"
  exit 1
}

if (-not $EnvFile) {
  $EnvFile = Join-Path -Path $resolvedPackageRoot -ChildPath "deploy\\relay-proxy.env.example"
}

$binaryPath = Join-Path -Path $env:SystemRoot -ChildPath "System32\\WindowsPowerShell\\v1.0\\powershell.exe"
$arguments = @(
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$runner`"",
  "-PackageRoot",
  "`"$resolvedPackageRoot`"",
  "-EnvFile",
  "`"$EnvFile`""
)
$binCmd = "`"$binaryPath`" " + ($arguments -join " ")

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Error "Service already exists: $ServiceName"
  exit 1
}

New-Service `
  -Name $ServiceName `
  -DisplayName $ServiceDisplayName `
  -Description $Description `
  -BinaryPathName $binCmd `
  -StartupType Automatic

Set-Service -Name $ServiceName -StartupType Automatic

if ($StartImmediately) {
  Start-Service -Name $ServiceName
}

Write-Host "Installed service: $ServiceName"
Write-Host "Env file: $EnvFile"
