param(
  [Alias("t")]
  [string]$Target = "",
  [string]$SshCommand = "ssh",
  [Alias("p")]
  [int]$SshPort = 22,
  [string]$IdentityFile = "",
  [ValidateSet("on", "off")]
  [string]$StrictHostKeyChecking = "on",
  [int]$ConnectTimeoutSeconds = 8,
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
$EXIT_REMOTE_CHECK = 4

function Print-Usage {
  @"
Validate a remote host for CommandRelay tmux runtime over SSH.

Usage:
  validate-remote-runtime.ps1 -Target <user@host> [options]

Required:
  -Target <user@host>                   SSH target (user@host or SSH config alias)

Options:
  -SshCommand <command>                 SSH command (default: ssh)
  -SshPort <port>                       SSH server port (default: 22)
  -IdentityFile <path>                  SSH identity key
  -SshOption <option>                   Extra SSH option passed as '-o <option>' (repeatable)
  -StrictHostKeyChecking <on|off>        Host key checking mode
  -ConnectTimeoutSeconds <seconds>       Connect timeout in seconds (1..60)
  -DryRun                               Validate local inputs only
  -Help                                 Show this help

Examples:
  .\validate-remote-runtime.ps1 -Target relay@relay-host
  .\validate-remote-runtime.ps1 -Target relay@relay-host -IdentityFile "C:\Users\YOU\.ssh\id_ed25519"
"@
}

function Exit-With-Usage {
  param([string]$message)
  Write-Host "FAIL usage: $message" -ForegroundColor Red
  Print-Usage
  exit $EXIT_USAGE
}

function Exit-Fail {
  param(
    [string]$message,
    [int]$code
  )
  Write-Host "FAIL local: $message" -ForegroundColor Red
  exit $code
}

function Ensure-Range {
  param(
    [int]$Value,
    [string]$Label,
    [int]$Min,
    [int]$Max
  )
  if ($Value -lt $Min -or $Value -gt $Max) {
    Exit-With-Usage "${Label} must be in range ${Min}..${Max}: ${Value}"
  }
}

function Ensure-Token {
  param(
    [string]$Value,
    [string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Exit-With-Usage "${Label} is required"
  }
  if ($Value.Trim().StartsWith("-")) {
    Exit-With-Usage "${Label} must not start with '-': ${Value}"
  }
  if ($Value -match "\s") {
    Exit-With-Usage "${Label} must not contain whitespace: ${Value}"
  }
}

if ($Help) {
  Print-Usage
  exit $EXIT_OK
}

Ensure-Token -Value $Target -Label "-Target"
Ensure-Range -Value $ConnectTimeoutSeconds -Label "--connect-timeout-seconds" -Min 1 -Max 60
Ensure-Range -Value $SshPort -Label "--ssh-port" -Min 1 -Max 65535

if (-not (Get-Command $SshCommand -ErrorAction SilentlyContinue)) {
  Exit-Fail "ssh command not found: $SshCommand" $EXIT_LOCAL_SSH
}

if ($IdentityFile -and -not (Test-Path -Path $IdentityFile -PathType Leaf)) {
  Exit-With-Usage "identity file does not exist: $IdentityFile"
}

Write-Host "PASS local: input validation"
Write-Host "PASS local: ssh command available"

if ($DryRun) {
  Write-Host "PASS dry-run: remote checks not executed"
  $identityLabel = if ([string]::IsNullOrWhiteSpace($IdentityFile)) { "default" } else { "configured" }
  Write-Host "INFO target=$Target port=$SshPort strict_host_key_checking=$StrictHostKeyChecking timeout=${ConnectTimeoutSeconds}s identity=$identityLabel extra_ssh_options=$($SshOption.Count)"
  exit $EXIT_OK
}

$remoteCommand = "command -v tmux >/dev/null 2>&1 && tmux -V && node -v"
$sshArgs = @(
  "-T",
  "-p", $SshPort,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=$ConnectTimeoutSeconds",
  "-o", "LogLevel=ERROR"
)

if ($IdentityFile) {
  $sshArgs += @("-i", $IdentityFile)
}

if ($StrictHostKeyChecking -eq "on") {
  $sshArgs += @("-o", "StrictHostKeyChecking=yes")
} else {
  $sshArgs += @("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null")
}

foreach ($option in $SshOption) {
  if (-not [string]::IsNullOrWhiteSpace($option)) {
    $sshArgs += @("-o", $option)
  }
}

$sshArgs += @($Target, "sh -lc `"$remoteCommand`"")

$output = $null
try {
  $output = & $SshCommand @sshArgs 2>&1
}
catch {
  Write-Host "FAIL remote: runtime validation command failed"
  Write-Host "FAIL detail: $($_.Exception.Message)"
  exit $EXIT_REMOTE_CHECK
}

if ($LASTEXITCODE -eq 0) {
  $tmuxVersion = ($output | Where-Object { $_ -match "^tmux " } | Select-Object -First 1)
  $nodeVersion = ($output | Where-Object { $_ -match "^v[0-9]+\." } | Select-Object -First 1)
  if ($tmuxVersion) { Write-Host "PASS remote: tmux runtime detected ($tmuxVersion)" }
  if ($nodeVersion) { Write-Host "PASS remote: node runtime detected ($nodeVersion)" }
  exit $EXIT_OK
}

Write-Host "FAIL remote: runtime validation command failed"
if ($output) {
  Write-Host "FAIL detail: $($output | Select-Object -First 1)"
}
exit $EXIT_REMOTE_CHECK
