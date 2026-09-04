# Compatibility entry point for the Hardware Explorer trace normalizer.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $RawTrace,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $Output,
    [UInt32] $SampleRate = 1,
    [UInt64] $EventLimit = 0
)

& (Join-Path $PSScriptRoot 'hardware-explore-normalize-trace.ps1') `
    -RawTrace $RawTrace -Image $Image -Output $Output `
    -SampleRate $SampleRate -EventLimit $EventLimit
