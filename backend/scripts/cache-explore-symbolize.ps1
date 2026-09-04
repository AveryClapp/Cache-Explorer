#requires -Version 7.2
# Compatibility entry point for local PDB attribution.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Result,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $Pdb,
    [Parameter(Mandatory = $true)] [string] $Output,
    [string] $Symbolizer,
    [int] $TimeoutSeconds = 60
)
& (Join-Path $PSScriptRoot 'hardware-explore-symbolize.ps1') @PSBoundParameters
