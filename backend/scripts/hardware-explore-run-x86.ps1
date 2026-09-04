# Run an instrumented PE32 program and produce a portable trace v2 file.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Program,
    [string[]] $ArgumentList = @(),
    [string] $Output = 'hardware-explorer-trace-v2.txt',
    [UInt32] $SampleRate = 1,
    [UInt64] $MaxEvents = 10000000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$programPath = (Resolve-Path -LiteralPath $Program).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if ($programPath -eq $outputPath) {
    throw 'Program and Output must be different files.'
}
if ($SampleRate -lt 1) {
    throw 'SampleRate must be at least 1.'
}
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

    & (Join-Path $PSScriptRoot 'hardware-explore-normalize-trace.ps1') `
        -RawTrace $rawTrace -Image $programPath -Output $outputPath `
        -SampleRate $SampleRate -EventLimit $MaxEvents
    $normalized = $true
    if ($programExitCode -ne 0) {
        throw "The target exited with code $programExitCode. The partial trace was preserved at '$outputPath'."
    }
} finally {
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_TRACE', $previousTrace, 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_SAMPLE_RATE', $previousSampleRate, 'Process')
    [Environment]::SetEnvironmentVariable('HARDWARE_EXPLORER_MAX_EVENTS', $previousMaxEvents, 'Process')
    if ($normalized -and (Test-Path -LiteralPath $rawTrace)) {
        Remove-Item -LiteralPath $rawTrace -Force
    } elseif (Test-Path -LiteralPath $rawTrace) {
        Write-Warning "Trace normalization failed; raw capture preserved at '$rawTrace'."
    }
}

Write-Host "Hardware Explorer trace written to '$outputPath'."
