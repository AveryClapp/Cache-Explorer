# Compatibility entry point for Windows x86 trace capture.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Program,
    [string[]] $ArgumentList = @(),
    [string] $Output = 'hardware-explorer-trace-v2.txt',
    [UInt32] $SampleRate = 1,
    [UInt64] $MaxEvents = 2000000
)

& (Join-Path $PSScriptRoot 'hardware-explore-run-x86.ps1') @PSBoundParameters
