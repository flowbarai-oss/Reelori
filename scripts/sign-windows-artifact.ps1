param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
  [string]$SignTool = 'signtool.exe',
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
if ($CertificateThumbprint -notmatch '^[A-Fa-f0-9]{40,64}$') {
  throw 'A code-signing certificate thumbprint is required'
}
$resolved = (Resolve-Path -LiteralPath $File -ErrorAction Stop).ProviderPath
$cert = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
  Where-Object { $_.Thumbprint -ieq $CertificateThumbprint -and $_.HasPrivateKey } |
  Select-Object -First 1
if (!$cert) { throw 'Code-signing certificate with private key was not found' }
if (![bool]($cert.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' })) {
  throw 'Certificate is not valid for code signing'
}
& $SignTool sign /sha1 $cert.Thumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $resolved
if ($LASTEXITCODE -ne 0) { throw 'SignTool failed' }
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $cert.Thumbprint) {
  throw ('Signed artifact verification failed: ' + $signature.Status)
}
[PSCustomObject]@{ file=$resolved; sha256=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash; signer=$cert.Thumbprint; signatureStatus='Valid' }
