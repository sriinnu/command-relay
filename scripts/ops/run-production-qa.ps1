[CmdletBinding()]
param(
  [string[]]$Section = @(),
  [string]$BatchDate = (Get-Date -AsUTC).ToString('yyyy-MM-dd'),
  [string]$Host = '127.0.0.1',
  [string]$Port = '8788',
  [string]$Upstream = 'ws://127.0.0.1:8787/ws',
  [string]$RelayPath = '/ws',
  [string]$HealthPath = '/health',
  [string]$Token = 'my-token',
  [string]$PackageSelector = '@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*',
  [int]$WatchIntervalMs = 1500,
  [ValidateSet('true', 'false')][string]$RestartOnChange = 'true',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$relayCli = Join-Path $repoRoot 'packages/commandrelay-relay-proxy/dist/cli.js'
$artifactDir = Join-Path $repoRoot 'artifacts'
$relayLog = Join-Path $artifactDir 'run-production-qa-relay.log'
$knownSections = @('deps', 'ci', 'release', 'relay', 'smoke')

$selectedSections = @()
$passes = @()
$fails = @()

function Write-Header {
  param([string]$Text)
  Write-Host "`n===================================================="
  Write-Host $Text
}

function Normalize-Sections {
  param([string[]]$InputSections)
  if ($InputSections.Count -eq 0) {
    return @()
  }

  $resolved = @()
  foreach ($raw in $InputSections) {
    foreach ($part in ($raw -split ',')) {
      $section = $part.Trim().ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($section)) {
        continue
      }
      if ($section -eq 'all') {
        return @('all')
      }
      if ($knownSections -notcontains $section) {
        throw "Unknown section: $section. Allowed: deps, ci, release, relay, smoke, all."
      }
      if ($resolved -notcontains $section) {
        $resolved += $section
      }
    }
  }
  return $resolved
}

function Run-RepoCommand {
  param([string[]]$Command)
  $oldLocation = Get-Location
  try {
    Set-Location $repoRoot
    & $Command[0] @($Command[1..($Command.Count - 1)])
    if ($LASTEXITCODE -ne 0) {
      throw "Command '$($Command -join ' ')' exited with code $LASTEXITCODE"
    }
    Write-Host "CMD: $($Command -join ' ')"
  } finally {
    Set-Location $oldLocation
  }
}

function Run-Step {
  param([string]$Label, [scriptblock]$Action)
  Write-Header "RUN: $Label"
  try {
    & $Action
    Write-Host "PASS: $Label"
    return $true
  } catch {
    Write-Warning "FAIL: $Label"
    Write-Warning $_.Exception.Message
    return $false
  }
}

function Section-Selected {
  param([string]$Name)
  if ($selectedSections.Count -eq 0) {
    return $true
  }
  if ($selectedSections -contains 'all') {
    return $true
  }
  return ($selectedSections -contains $Name)
}

function Wait-ForEndpoint {
  param(
    [string]$Uri,
    [hashtable]$Headers = @{},
    [int]$Attempts = 30
  )
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing -Method Get -TimeoutSec 1 | Out-Null
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

function Probe-RelayEndpoints {
  $healthUrl = "http://$Host`:$Port$HealthPath"
  $statusUrl = "http://$Host`:$Port/status"
  $headers = @{}
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $headers["Authorization"] = "Bearer $Token"
  }

  if (-not (Wait-ForEndpoint -Uri $healthUrl -Headers $headers)) {
    throw "Relay health endpoint did not come up: $healthUrl"
  }

  $status = Invoke-RestMethod -Uri $statusUrl -Headers $headers -TimeoutSec 5 -Method Get
  if ($null -eq $status.statusContractVersion -or [int]$status.statusContractVersion -ne 2) {
    throw "Invalid statusContractVersion. Expected 2."
  }
  if ([string]::IsNullOrWhiteSpace($status.configFingerprint)) {
    throw 'status.configFingerprint is missing'
  }
  if ($null -eq $status.heartbeat -or $null -eq $status.heartbeat.checkedAtMs) {
    throw 'status.heartbeat.checkedAtMs is missing'
  }
  if ($null -eq $status.upstream -or $null -eq $status.upstream.rotation -or [string]::IsNullOrWhiteSpace($status.upstream.rotation.status)) {
    throw 'status.upstream.rotation.status is missing'
  }

  Write-Host "statusContractVersion=$($status.statusContractVersion)"
  Write-Host "rotationStatus=$($status.upstream.rotation.status)"
  Write-Host "checkedAtMs=$($status.heartbeat.checkedAtMs)"

  try {
    Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -Method Get -TimeoutSec 5 | Out-Null
    throw 'unauthorized request to /status unexpectedly succeeded'
  } catch {
    $resp = $_.Exception.Response
    if ($null -eq $resp -or [int]$resp.StatusCode -ne 401) {
      throw
    }
  }
}

function Start-And-Probe-Relay {
  if (-not (Test-Path -Path $relayCli)) {
    throw "Relay CLI missing at $relayCli"
  }

  if (-not (Test-Path -Path $artifactDir)) {
    New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
  }
  if (Test-Path -Path $relayLog) {
    Remove-Item -Path $relayLog -Force
  }

  $hasPrevToken = $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN -ne $null
  $prevToken = $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN
  $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN = $Token

  $relayArgs = @(
    $relayCli,
    '--host',
    $Host,
    '--port',
    $Port,
    '--upstream',
    $Upstream,
    '--relay-path',
    $RelayPath,
    '--health-path',
    $HealthPath,
    '--upstream-tls-watch-interval-ms',
    "$WatchIntervalMs",
    '--upstream-tls-restart-on-change',
    $RestartOnChange
  )

  try {
    $process = Start-Process -FilePath 'node' -ArgumentList $relayArgs -WorkingDirectory $repoRoot -PassThru -NoNewWindow -RedirectStandardOutput $relayLog -RedirectStandardError $relayLog
  } finally {
    if ($hasPrevToken) {
      $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN = $prevToken
    } else {
      $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN = $null
    }
  }

  if ($null -eq $process) {
    throw 'Failed to start relay process.'
  }

  if ($process.HasExited) {
    if (Test-Path $relayLog) {
      Get-Content $relayLog -Tail 80 | ForEach-Object { Write-Warning $_ }
    }
    throw 'Relay process exited immediately.'
  }

  try {
    Probe-RelayEndpoints
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

function Run-SectionDependencies {
  if (-not (Run-Step 'preflight tooling' { Run-RepoCommand @('node', '-v') })) { return $false }
  if (-not (Run-Step 'pnpm version' { Run-RepoCommand @('pnpm', '-v') })) { return $false }
  if (-not (Run-Step 'git status pre-check' { Run-RepoCommand @('git', 'status', '--short') })) { return $false }
  if (-not (Run-Step 'workspace integrity' { Run-RepoCommand @('pnpm', 'run', 'check:all') })) { return $false }
  if (-not (Run-Step 'package build' { Run-RepoCommand @('pnpm', 'run', 'build:packages') })) { return $false }
  if (-not (Run-Step 'package tests' { Run-RepoCommand @('pnpm', 'run', 'test:packages') })) { return $false }
  if (-not (Run-Step 'consumer smoke' { Run-RepoCommand @('pnpm', 'run', 'verify:consumer-smoke') })) { return $false }
  return $true
}

function Run-SectionCi {
  if (-not (Run-Step 'ci:check' { Run-RepoCommand @('pnpm', 'run', 'ci:check') })) { return $false }
  if (-not (Run-Step 'ci:build' { Run-RepoCommand @('pnpm', 'run', 'ci:build') })) { return $false }
  if (-not (Run-Step 'ci:test' { Run-RepoCommand @('pnpm', 'run', 'ci:test') })) { return $false }
  if (-not (Run-Step 'ci:all' { Run-RepoCommand @('pnpm', 'run', 'ci:all') })) { return $false }
  return $true
}

function Run-SectionRelease {
  if (-not (Run-Step 'lockstep' { Run-RepoCommand @('pnpm', 'run', 'release:proxy:lockstep') })) { return $false }
  if (-not (Run-Step 'preflight' { Run-RepoCommand @('pnpm', 'run', 'release:proxy:preflight', '--', '--batch-date', $BatchDate, '--package-selector', $PackageSelector) })) { return $false }
  if (-not (Run-Step 'deterministic validate' { Run-RepoCommand @('pnpm', 'run', 'release:proxy:deterministic-validate', '--', '--with-build') })) { return $false }
  return $true
}

function Run-SectionRelay {
  if (-not (Run-Step 'build relay package' { Run-RepoCommand @('pnpm', '--filter', '@commandrelay/relay-proxy', 'run', 'build') })) { return $false }
  if (-not (Run-Step 'relay unit tests' { Run-RepoCommand @('pnpm', '--filter', '@commandrelay/relay-proxy', 'run', 'test') })) { return $false }
  if (-not (Run-Step 'relay health + status contract probe' { Start-And-Probe-Relay })) { return $false }
  return $true
}

function Run-SectionSmoke {
  $workspaces = @(
    '@commandrelay/cli-proxy',
    '@commandrelay/proxy-core',
    '@commandrelay/proxy-agent',
    '@commandrelay/proxy-http-client',
    '@commandrelay/proxy-fetch',
    '@commandrelay/proxy-undici',
    '@commandrelay/proxy-axios',
    '@commandrelay/proxy-got',
    '@commandrelay/proxy-runtime',
    '@commandrelay/relay-proxy',
    '@commandrelay/client',
    '@commandrelay/protocol',
    '@commandrelay/tui'
  )
  foreach ($workspace in $workspaces) {
    if (-not (Run-Step "test $workspace" { Run-RepoCommand @('pnpm', '--filter', $workspace, 'run', 'test') })) {
      return $false
    }
  }
  return $true
}

function Record-SectionResult {
  param([string]$Section, [bool]$Passed)
  if ($Passed) {
    $script:passes += $Section
  } else {
    $script:fails += $Section
  }
}

$selectedSections = Normalize-Sections -InputSections $Section

if (-not $SkipInstall) {
  if (-not (Run-Step 'pnpm install' { Run-RepoCommand @('pnpm', 'install', '--frozen-lockfile') })) {
    $fails += 'pnpm-install'
    Write-Host 'Production QA run summary'
    Write-Host 'Passes: 0'
    Write-Host 'Fails: 1'
    Write-Host 'FAIL: pnpm install'
    exit 1
  }
}

if (Section-Selected 'deps') {
  Record-SectionResult -Section 'deps' -Passed (Run-SectionDependencies)
}
if (Section-Selected 'ci') {
  Record-SectionResult -Section 'ci' -Passed (Run-SectionCi)
}
if (Section-Selected 'release') {
  Record-SectionResult -Section 'release' -Passed (Run-SectionRelease)
}
if (Section-Selected 'relay') {
  Record-SectionResult -Section 'relay' -Passed (Run-SectionRelay)
}
if (Section-Selected 'smoke') {
  Record-SectionResult -Section 'smoke' -Passed (Run-SectionSmoke)
}

if ($selectedSections.Count -eq 0) {
  $selectedSections = @('all')
}

Write-Host "`n===================================================="
Write-Host 'Production QA run summary'
Write-Host "Sections run: $($selectedSections -join ', ')"
Write-Host "Passes: $($passes.Count)"
Write-Host "Fails: $($fails.Count)"

if ($passes.Count -gt 0) {
  Write-Host "PASS: $($passes -join ', ')"
}
if ($fails.Count -gt 0) {
  Write-Host "FAIL: $($fails -join ', ')"
  exit 1
}

Write-Host 'PASS: production QA run completed'
exit 0
