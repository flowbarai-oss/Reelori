$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'Programs\Reelori'
$pointer = Join-Path $base 'current.txt'
if (-not [IO.File]::Exists($pointer)) { throw 'Reelori program version pointer is missing' }
$version = [IO.File]::ReadAllText($pointer).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$') {
  throw 'Reelori program version pointer is invalid'
}
$directory = Join-Path (Join-Path $base 'versions') $version
$entry = Join-Path $directory 'desktop\Reelori.exe'
if (-not [IO.File]::Exists($entry)) {
  throw 'Reelori program files are incomplete'
}
Push-Location $directory
try { & $entry; exit $LASTEXITCODE }
finally { Pop-Location }
