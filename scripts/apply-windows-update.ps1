param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$TrustedThumbprint,
  [Parameter(Mandatory=$true)][string]$Version,
  [int]$WaitProcessId = 0
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$') {
  throw 'Invalid update version'
}
$dataRoot = Join-Path $env:LOCALAPPDATA 'Reelori'
$updateRoot = [IO.Path]::GetFullPath((Join-Path $dataRoot 'updates'))
$installerPath = (Resolve-Path -LiteralPath $Installer -ErrorAction Stop).ProviderPath
if (!$installerPath.StartsWith($updateRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer is outside the update staging directory' }
$null = & (Join-Path $PSScriptRoot 'verify-windows-installer.ps1') -Installer $installerPath `
  -ExpectedSha256 $ExpectedSha256 -TrustedThumbprint $TrustedThumbprint
$program = Join-Path $env:LOCALAPPDATA 'Programs\Reelori'
$pointer = Join-Path $program 'current.txt'
if (!(Test-Path -LiteralPath $pointer)) { throw 'No installed Reelori version' }
$previous = [IO.File]::ReadAllText($pointer).Trim()
if ($previous -notmatch '^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$' -or
    $previous -eq $Version) { throw 'Invalid or unchanged current version' }
$previousExe = Join-Path $program "versions\$previous\desktop\Reelori.exe"
if (!(Test-Path -LiteralPath $previousExe)) { throw 'Previous version is unavailable for rollback' }
$newRoot = Join-Path $program "versions\$Version"
$newExe = Join-Path $newRoot 'desktop\Reelori.exe'
$staged = Join-Path $program 'staged.txt'
$receipt = Join-Path $updateRoot "update-$Version-result.json"

function Set-Current([string]$value) {
  $temporary = Join-Path $program 'current.next'
  $backup = Join-Path $program 'current.bak'
  [IO.File]::WriteAllText($temporary, $value)
  [IO.File]::Replace($temporary, $pointer, $backup)
}
function Verify-Package {
  $manifest = Join-Path $newRoot 'SHA256SUMS.txt'
  if (!(Test-Path -LiteralPath $manifest)) { throw 'Installed package manifest is missing' }
  $lines = [IO.File]::ReadAllLines($manifest)
  if ($lines.Count -lt 300) { throw 'Installed package manifest is incomplete' }
  foreach ($line in $lines) {
    $entry = [regex]::Match($line, '^([a-f0-9]{64})  ([A-Za-z0-9._ /-]+)$')
    if (!$entry.Success -or $entry.Groups[2].Value.Contains('..')) {
      throw 'Invalid installed package manifest entry'
    }
    $relative = $entry.Groups[2].Value
    $target = Join-Path $newRoot ($relative -replace '/', '\')
    if (!(Test-Path -LiteralPath $target) -or
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $entry.Groups[1].Value) {
      throw "Installed package checksum mismatch: $relative"
    }
  }
}
function Wait-ForLocalService([bool]$ready) {
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  do {
    try {
      $client = New-Object Net.Sockets.TcpClient
      $task = $client.ConnectAsync('127.0.0.1', 5179)
      $connected = $task.Wait(500) -and $client.Connected
      $client.Close()
    } catch { $connected = $false }
    if ($connected -eq $ready) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Local service did not reach the required state'
}
function Wait-ForHealthyApp {
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  do {
    try {
      $response = Invoke-WebRequest 'http://127.0.0.1:5179/api/session' -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'New version did not pass the local session probe'
}

$switched = $false
try {
  if ($WaitProcessId -gt 0) {
    $old = Get-Process -Id $WaitProcessId -ErrorAction SilentlyContinue
    if ($old) {
      $old.WaitForExit(120000)
      if (!$old.HasExited) { throw 'Close Reelori before upgrading' }
    }
  }
  Wait-ForLocalService $false
  $process = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)" }
  if (!(Test-Path -LiteralPath $newExe) -or !(Test-Path -LiteralPath $staged) -or
      [IO.File]::ReadAllText($staged).Trim() -ne $Version) { throw 'New version was not staged' }
  Verify-Package
  [IO.File]::WriteAllText((Join-Path $program 'previous.txt'), $previous)
  Set-Current $Version
  $switched = $true
  $app = Start-Process -FilePath $newExe -WorkingDirectory $newRoot -PassThru
  Wait-ForHealthyApp
  Remove-Item -LiteralPath $staged -ErrorAction SilentlyContinue
  [PSCustomObject]@{ status='installed'; from=$previous; to=$Version; at=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
} catch {
  $reason = $_.Exception.Message
  if ($switched) {
    if ($app -and !$app.HasExited) { & taskkill.exe /PID $app.Id /T /F 2>$null | Out-Null }
    try { Wait-ForLocalService $false } catch { }
    Set-Current $previous
    Start-Process -FilePath $previousExe -WorkingDirectory (Split-Path (Split-Path $previousExe)) | Out-Null
    try { Wait-ForHealthyApp } catch { $reason += '; rollback launch probe failed: ' + $_.Exception.Message }
  }
  [PSCustomObject]@{ status='failed'; from=$previous; to=$Version; rolledBack=$switched; error=$reason; at=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
  throw
}
