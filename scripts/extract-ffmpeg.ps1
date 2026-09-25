param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$prefix = 'ffmpeg-9.0.2-essentials_build/'
$wanted = @{
  ($prefix + 'bin/ffmpeg.exe') = 'ffmpeg.exe'
  ($prefix + 'LICENSE') = 'LICENSE'
  ($prefix + 'README.txt') = 'UPSTREAM-README.txt'
}
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach ($name in $wanted.Keys) {
    $entry = $zip.GetEntry($name)
    if ($null -eq $entry) { throw "Pinned FFmpeg archive is missing $name" }
    $target = Join-Path $Destination $wanted[$name]
    if ([IO.File]::Exists($target)) { throw "FFmpeg target already exists: $target" }
    $source = $entry.Open()
    try {
      $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
      try { $source.CopyTo($output) }
      finally { $output.Dispose() }
    } finally { $source.Dispose() }
  }
} finally { $zip.Dispose() }
