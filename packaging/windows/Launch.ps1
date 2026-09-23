param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'Programs\Reelori'
$pointer = Join-Path $base 'current.txt'
if (-not [IO.File]::Exists($pointer)) { throw 'Reelori program version pointer is missing' }
$version = [IO.File]::ReadAllText($pointer).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$') {
  throw 'Reelori program version pointer is invalid'
}
$directory = Join-Path (Join-Path $base 'versions') $version
$runtime = Join-Path $directory 'runtime\node.exe'
$entry = Join-Path $directory 'scripts\start.mjs'
if (-not [IO.File]::Exists($runtime) -or -not [IO.File]::Exists($entry)) {
  throw 'Reelori program files are incomplete'
}
$env:REELORI_DATA_DIR = Join-Path $env:LOCALAPPDATA 'Reelori\data'
$env:REELORI_WORKSPACE_SELECTION_FILE = Join-Path $env:LOCALAPPDATA 'Reelori\workspace-selection.json'
$env:REELORI_OPEN_BROWSER = if ($NoBrowser) { '0' } else { '1' }
Push-Location $directory
try { & $runtime $entry; exit $LASTEXITCODE }
finally { Pop-Location }
