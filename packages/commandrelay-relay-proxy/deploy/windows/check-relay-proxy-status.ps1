param(
  [string]$StatusUri = "http://127.0.0.1:8788/status",
  [string]$StatusToken = "",
  [int]$IntervalSeconds = 2
)

Set-StrictMode -Version Latest
$headers = @{}
if ([string]::IsNullOrWhiteSpace($StatusToken)) {
  $StatusToken = $env:COMMANDRELAY_RELAY_REQUIRED_TOKEN
}
if (-not [string]::IsNullOrWhiteSpace($StatusToken)) {
  $headers["Authorization"] = "Bearer $StatusToken"
}

while ($true) {
  try {
    $s = Invoke-RestMethod -Method Get -Uri $StatusUri -Headers $headers -TimeoutSec 5
    $time = (Get-Date).ToString("o")
    if ($s.status -eq "open") {
      Write-Host "$time status=open checkedAtMs=$($s.heartbeat.checkedAtMs) active=$($s.activeConnections) total=$($s.totalConnections)"
    } else {
      Write-Host "$time status=$($s.status)"
    }
  } catch {
    Write-Host "status check failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $IntervalSeconds
}
