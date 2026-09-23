param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$Version
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $prefix = "node-v$Version-win-x64/"
  foreach ($item in @('node.exe', 'LICENSE')) {
    $entry = $zip.GetEntry($prefix + $item)
    if ($null -eq $entry) { throw "Node archive missing $item" }
    $out = Join-Path $Destination $item
    $source = $entry.Open()
    $target = [System.IO.File]::Open($out, [System.IO.FileMode]::CreateNew)
    try { $source.CopyTo($target) }
    finally { $target.Dispose(); $source.Dispose() }
  }
}
finally { $zip.Dispose() }
