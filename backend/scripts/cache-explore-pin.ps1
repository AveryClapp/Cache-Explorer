# Compatibility name for the Windows IA-32 local capture workflow.
#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Program,
    [Parameter(Mandatory)] [string] $PinRoot,
    [string[]] $ArgumentList = @(),
    [string] $Output,
    [string] $PinTool,
    [string] $Normalizer,
    [UInt32] $SampleRate,
    [UInt32] $MaxEvents,
    [int] $TimeoutSeconds
)
& (Join-Path $PSScriptRoot 'hardware-explore-pin.ps1') @PSBoundParameters
