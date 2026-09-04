# Run an instrumented PE32 program and produce a portable trace v2 file.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Program,
    [string[]] $ArgumentList = @(),
    [string] $Output = 'hardware-explorer-trace-v2.txt',
    [ValidateRange(1, 2147483647)] [UInt32] $SampleRate = 1,
    [ValidateRange(1, 2000000)] [UInt64] $MaxEvents = 2000000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'hardware-explorer-pe.ps1')

$programPath = (Resolve-Path -LiteralPath $Program).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if ($programPath -eq $outputPath) {
    throw 'Program and Output must be different files.'
}
Get-HardwareExplorerPeImage $programPath | Out-Null
$imageSha256 = (Get-FileHash -LiteralPath $programPath -Algorithm SHA256).Hash
$rawTrace = Join-Path ([IO.Path]::GetTempPath()) "hardware-explorer-$([Guid]::NewGuid().ToString('N')).raw"
$previousTrace = [Environment]::GetEnvironmentVariable('HARDWARE_EXPLORER_TRACE', 'Process')
$previousSampleRate = [Environment]::GetEnvironmentVariable('HARDWARE_EXPLORER_SAMPLE_RATE', 'Process')
$previousMaxEvents = [Environment]::GetEnvironmentVariable('HARDWARE_EXPLORER_MAX_EVENTS', 'Process')
$normalized = $false

try {
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_TRACE', $rawTrace, 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_SAMPLE_RATE', $SampleRate.ToString(), 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_MAX_EVENTS', $MaxEvents.ToString(), 'Process')
    & $programPath @ArgumentList
    $programExitCode = $LASTEXITCODE
    if ($programExitCode -ne 0) {
        throw "The target exited with code $programExitCode. No normalized trace was published."
    }

    & (Join-Path $PSScriptRoot 'hardware-explore-normalize-trace.ps1') `
        -RawTrace $rawTrace -Image $programPath -Output $outputPath `
        -SampleRate $SampleRate -EventLimit $MaxEvents -ExpectedImageSha256 $imageSha256
    $normalized = $true
} finally {
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_TRACE', $previousTrace, 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_SAMPLE_RATE', $previousSampleRate, 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_MAX_EVENTS', $previousMaxEvents, 'Process')
    if ($normalized -and (Test-Path -LiteralPath $rawTrace)) {
        Remove-Item -LiteralPath $rawTrace -Force
    } elseif (Test-Path -LiteralPath $rawTrace) {
        Write-Warning "Capture or normalization failed; raw capture preserved at '$rawTrace'."
    }
}

Write-Host "Hardware Explorer trace written to '$outputPath'."
