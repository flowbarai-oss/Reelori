param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$TrustedThumbprint,
  [switch]$RequirePublicTrust
)
$ErrorActionPreference = 'Stop'
if ($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid expected SHA-256' }
if ($TrustedThumbprint -notmatch '^[A-Fa-f0-9]{40,64}$') { throw 'Invalid trusted signer thumbprint' }
$file = (Resolve-Path -LiteralPath $Installer -ErrorAction Stop).ProviderPath
$hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
if ($hash -ine $ExpectedSha256) { throw 'Installer SHA-256 mismatch' }
$signature = Get-AuthenticodeSignature -LiteralPath $file
if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate) {
  throw ('Installer Authenticode signature is not valid: ' + $signature.Status)
}
if ($signature.SignerCertificate.Thumbprint -ine $TrustedThumbprint) {
  throw 'Installer signer does not match the pinned certificate'
}
if ($RequirePublicTrust) {
  if ($signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer) {
    throw 'Self-signed QA certificates cannot pass the public release gate'
  }
  if (!$signature.TimeStamperCertificate) {
    throw 'Public release signature must have a trusted timestamp'
  }
  $codeSigningOid = '1.3.6.1.5.5.7.3.3'
  if (![bool]($signature.SignerCertificate.EnhancedKeyUsageList |
      Where-Object { $_.ObjectId -eq $codeSigningOid })) {
    throw 'Public release signer must be a code-signing certificate'
  }
}
[PSCustomObject]@{ path=$file; sha256=$hash; signer=$signature.SignerCertificate.Thumbprint; status='verified' }
