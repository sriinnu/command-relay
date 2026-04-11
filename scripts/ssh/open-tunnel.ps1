param(
  [Alias("t")]
  [string]$Target = "",
  [string]$LocalHost = "127.0.0.1",
  [Alias("l")]
  [int]$LocalPort = 8787,
  [string]$RemoteHost = "127.0.0.1",
  [Alias("r")]
  [int]$RemotePort = 8787,
  [string]$SshCommand = "ssh",
  [Alias("p")]
  [int]$SshPort = 22,
  [Alias("i")]
  [string]$IdentityFile = "",
  [Alias("o")]
  [string[]]$SshOption = @(),
  [switch]$DryRun,
  [Alias("h")]
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$EXIT_OK = 0
$EXIT_USAGE = 2
$EXIT_LOCAL_SSH = 3
$EXIT_REMOTE = 4

function Fail {
  param(
    [string]$message,
    [int]$code = $EXIT_USAGE
  )
  Write-Error "FAIL: $message"
  exit $code
}

function Print-Usage {
  @'
Open an SSH local tunnel for CommandRelay HTTP/WebSocket access.

Usage:
  open-tunnel.ps1 -Target <user@host> [options]

Required:
  -Target <user@host>                SSH target (user@host or SSH config alias)

Options:
  -LocalHost <host>                  Local bind host (default: 127.0.0.1)
  -LocalPort <port>                  Local bind port (default: 8787)
  -RemoteHost <host>                 Remote forward host (default: 127.0.0.1)
  -RemotePort <port>                 Remote forward port (default: 8787)
  -SshPort <port>                    SSH server port (default: 22)
  -SshCommand <path>                 SSH executable path (default: ssh)
  -IdentityFile <path>               SSH identity key path
  -SshOption <option>                Extra SSH option passed as '-o <option>' (repeatable)
  -DryRun                            Print resolved command and exit
  -Help                              Show this help

Aliases:
  -t, -l, -r, -p, -i, -o
  -h maps to -Help

Examples:
  .\open-tunnel.ps1 -Target relay@relay-host
  .\open-tunnel.ps1 -Target relay@relay-host -LocalPort 9878
  .\open-tunnel.ps1 -Target relay@relay-host -IdentityFile "C:\Users\YOU\.ssh\id_ed25519"
'@
}

function Ensure-Range {
  param(
    [int]$Value,
    [string]$Label
  )
  if ($Value -lt 1 -or $Value -gt 65535) {
    Fail "${Label} must be in range 1..65535: $Value" $EXIT_USAGE
  }
}

function Ensure-PathValue {
  param(
    [string]$Value,
    [string]$Label
  )
  if ($Value -match "\s") {
    Fail "${Label} must not contain whitespace: $Value" $EXIT_USAGE
  }
}

function Test-IsTarget {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Fail "-Target is required" $EXIT_USAGE
  }
  if ($Value.Trim().StartsWith("-")) {
    Fail "-Target must not start with '-': $Value" $EXIT_USAGE
  }
  if ($Value -match "\s") {
    Fail "-Target must not contain whitespace: $Value" $EXIT_USAGE
  }
}

function Test-PortAvailable {
  param(
    [string]$Host,
    [int]$Port
  )
  if (Get-Command "Get-NetTCPConnection" -ErrorAction SilentlyContinue) {
    $candidates = @("0.0.0.0", "::", $Host)
    try {
      $resolved = [System.Net.Dns]::GetHostAddresses($Host) | ForEach-Object { $_.ToString() }
      foreach ($item in $resolved) {
        if ($item -and -not ($candidates -contains $item)) {
          $candidates += $item
        }
      }
    }
    catch {
      # Keep host string candidates only.
    }

    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($null -ne $listeners -and
      ($listeners | Where-Object { $_.LocalAddress -in $candidates }).Count -gt 0) {
      return $false
    }
    return $true;
  }

  try {
    $addr = [System.Net.Dns]::GetHostAddresses($Host) | Select-Object -First 1
    if (-not $addr) {
      return $false
    }
    $listener = [System.Net.Sockets.TcpListener]::new($addr, $Port)
    $listener.Start()
    $listener.Stop()
    return $true
  }
  catch {
    return $false
  }
}

function Format-Arg {
  param([string]$Arg)
  if ($Arg -match "[`"\s]") {
    return '"' + $Arg.Replace('"', '\"') + '"'
  }
  return $Arg
}

if ($Help) {
  Print-Usage
  exit $EXIT_OK
}

Test-IsTarget -Value $Target
Ensure-PathValue -Value $LocalHost -Label "LocalHost"
Ensure-PathValue -Value $RemoteHost -Label "RemoteHost"
Ensure-Range -Value $LocalPort -Label "LocalPort"
Ensure-Range -Value $RemotePort -Label "RemotePort"
Ensure-Range -Value $SshPort -Label "SshPort"

if (-not (Get-Command $SshCommand -ErrorAction SilentlyContinue)) {
  Fail "ssh command not found in PATH: $SshCommand" $EXIT_LOCAL_SSH
}

if (-not (Test-PortAvailable -Host $LocalHost -Port $LocalPort)) {
  Fail "Local port $LocalPort is already in use" $EXIT_LOCAL_SSH
}

if ($IdentityFile) {
  if (-not (Test-Path -Path $IdentityFile -PathType Leaf)) {
    Fail "Identity file does not exist: $IdentityFile" $EXIT_USAGE
  }
}

$forward = "${LocalHost}:${LocalPort}:${RemoteHost}:${RemotePort}"
$sshArgs = @(
  "-N",
  "-p", $SshPort,
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "TCPKeepAlive=yes"
)

if ($IdentityFile) {
  $sshArgs += @("-i", $IdentityFile)
}

foreach ($option in $SshOption) {
  if (-not [string]::IsNullOrWhiteSpace($option)) {
    $sshArgs += @("-o", $option)
  }
}

$sshArgs += @("-L", $forward, $Target)

Write-Host "Opening CommandRelay tunnel"
Write-Host "  SSH target: $Target (port $SshPort)"
Write-Host "  Forward: ${LocalHost}:${LocalPort} -> ${RemoteHost}:${RemotePort}"
Write-Host "  Local URLs: http://$LocalHost:$LocalPort and ws://$LocalHost:$LocalPort/ws"

if ($DryRun) {
  Write-Host "Dry run command:"
  Write-Host "$SshCommand $($sshArgs | ForEach-Object { Format-Arg $_ })"
  exit $EXIT_OK
}

try {
  & $SshCommand @sshArgs
}
catch {
  Fail "ssh command failed: $($_.Exception.Message)" $EXIT_REMOTE
}

if ($LASTEXITCODE -ne 0) {
  Fail "ssh command exited with code $LASTEXITCODE" $EXIT_REMOTE
}
