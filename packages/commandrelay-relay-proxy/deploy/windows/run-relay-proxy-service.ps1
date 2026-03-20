param(
  [string]$PackageRoot = "",
  [string]$EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-EnvFile {
  param([string]$Path)
  if (-not (Test-Path -Path $Path -PathType Leaf)) {
    return
  }

  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) {
      return
    }

    $key = $parts[0].Trim()
    $value = $parts[1]
    if ($key -and $value -ne $null) {
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

if (-not $PackageRoot) {
  $PackageRoot = Split-Path -Path $PSScriptRoot -Parent
}

$resolvedPackageRoot = (Resolve-Path -Path $PackageRoot).Path
$defaultEnvFile = Join-Path -Path $resolvedPackageRoot -ChildPath "deploy\\relay-proxy.env.example"
if (-not $EnvFile) {
  $EnvFile = $defaultEnvFile
}

Import-EnvFile -Path $EnvFile

$nodePath = (Get-Command node -ErrorAction Stop).Source
$cliPath = Join-Path -Path $resolvedPackageRoot -ChildPath "dist\\cli.js"
if (Test-Path -Path $cliPath -PathType Leaf) {
  & $nodePath $cliPath
  exit $LASTEXITCODE
}

$listenHost = if ($env:COMMANDRELAY_RELAY_LISTEN_HOST) { $env:COMMANDRELAY_RELAY_LISTEN_HOST } else { "127.0.0.1" }
$listenPort = if ($env:COMMANDRELAY_RELAY_LISTEN_PORT) { $env:COMMANDRELAY_RELAY_LISTEN_PORT } else { "8788" }
& commandrelay-relay-proxy --host $listenHost --port $listenPort
