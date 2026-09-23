param(
  [Parameter(Mandatory=$true)][ValidateSet('set','set-stdin','get','status','remove')][string]$Action,
  [Parameter(Mandatory=$true)][ValidateSet('flowbar','minimax','aliyun')][string]$Provider
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$base = Join-Path $env:LOCALAPPDATA 'Reelori\credentials'
$file = Join-Path $base ($Provider + '.dpapi')
if ($Action -eq 'status') {
  if ([IO.File]::Exists($file)) { [Console]::Out.Write('configured') }
  else { [Console]::Out.Write('missing') }
  exit 0
}
if ($Action -eq 'remove') {
  if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
  exit 0
}
if ($Action -eq 'get') {
  if (-not [IO.File]::Exists($file)) { exit 2 }
  $cipher = [IO.File]::ReadAllBytes($file)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
  }
  finally { [Array]::Clear($plain, 0, $plain.Length) }
  exit 0
}
if ($Action -eq 'set') {
  $secure = Read-Host 'Enter credential' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
else {
  $value = [Console]::In.ReadToEnd().TrimEnd("`r", "`n")
}
if (-not $value -or $value.Length -gt 4096) { throw 'Credential is empty or too large' }
$bytes = [Text.Encoding]::UTF8.GetBytes($value)
try {
  $cipher = [Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.Directory]::CreateDirectory($base) | Out-Null
  $temp = Join-Path $base ([IO.Path]::GetRandomFileName())
  try {
    [IO.File]::WriteAllBytes($temp, $cipher)
    Move-Item -LiteralPath $temp -Destination $file -Force
  }
  finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}
finally { [Array]::Clear($bytes, 0, $bytes.Length) }
