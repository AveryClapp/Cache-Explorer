# Compatibility entry point. The cache-explore name remains supported during
# the Hardware Explorer rebrand.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CompilerArguments
)

& (Join-Path $PSScriptRoot 'hardware-explore-clang-cl.ps1') @CompilerArguments
exit $LASTEXITCODE
