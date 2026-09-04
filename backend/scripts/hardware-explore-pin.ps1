# Local-only Preview. Executes an explicitly selected, trusted PE32 program.
#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Program,
    [Parameter(Mandatory)] [string] $PinRoot,
    [string[]] $ArgumentList = @(),
    [string] $WorkingDirectory,
    [string] $Output = 'hardware-explorer-pin-trace.txt',
    [string] $PinTool = (Join-Path $PSScriptRoot '../pin-tool/obj-ia32/hardware_explorer_pin.dll'),
    [string] $Normalizer = (Join-Path $PSScriptRoot '../cache-simulator/build/hardware-explorer-normalize-pin.exe'),
    [ValidateRange(1, 2147483647)] [UInt32] $SampleRate = 1,
    [ValidateRange(1, 2000000)] [UInt32] $MaxEvents = 2000000,
    [ValidateRange(0, 86400)] [int] $TimeoutSeconds = 0
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Intel Pin IA-32 capture requires Windows.' }
# Pin 4.3.1 reconstructs the target command line and can merge subsequent
# arguments after a literal quote. Reject unsupported forms before execution.
foreach ($argument in $ArgumentList) {
    if ([string]::IsNullOrEmpty($argument) -or $argument.Contains('"') -or
        $argument -match '[\x00-\x1f\x7f]' -or
        ($argument -match '\s' -and $argument.EndsWith('\'))) {
        throw 'This Pin Preview cannot safely forward empty arguments, literal quotes, control characters, or whitespace-containing arguments ending in a backslash.'
    }
}
. (Join-Path $PSScriptRoot 'hardware-explorer-pe.ps1')
$programPath = (Resolve-Path -LiteralPath $Program).Path
$pinPath = (Resolve-Path -LiteralPath (Join-Path $PinRoot 'pin.exe')).Path
$toolPath = (Resolve-Path -LiteralPath $PinTool).Path
$normalizerPath = (Resolve-Path -LiteralPath $Normalizer).Path
$outputPath = [IO.Path]::GetFullPath($Output)
$workingPath = if ($WorkingDirectory) { (Resolve-Path -LiteralPath $WorkingDirectory).Path }
    else { [IO.Path]::GetDirectoryName($programPath) }
if (-not [IO.Directory]::Exists($workingPath)) { throw 'WorkingDirectory must be an existing directory.' }
foreach ($inputPath in @($programPath, $pinPath, $toolPath, $normalizerPath)) {
    if ($outputPath -eq $inputPath) { throw 'Output must differ from the program and capture tools.' }
}
Get-HardwareExplorerPeImage $programPath | Out-Null
$expectedHash = (Get-FileHash -LiteralPath $programPath -Algorithm SHA256).Hash.ToLowerInvariant()
$outputDirectory = [IO.Path]::GetDirectoryName($outputPath)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$raw = Join-Path ([IO.Path]::GetTempPath()) "hardware-explorer-pin-$([Guid]::NewGuid().ToString('N')).partial.raw"
$temporary = Join-Path $outputDirectory ".hardware-explorer-pin-$([Guid]::NewGuid().ToString('N')).tmp"
$succeeded = $false

function Invoke-CaptureProcess {
    param([string] $Executable, [string[]] $Arguments, [int] $Timeout, [string] $Directory = '')
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    if ($Directory) { $start.WorkingDirectory = $Directory }
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $started = $false
    try {
        $started = $process.Start()
        if (-not $started) { throw 'Could not start capture process.' }
        if ($Timeout -gt 0) {
            if (-not $process.WaitForExit($Timeout * 1000)) {
                throw "Capture timed out after $Timeout seconds; no trace was published."
            }
        } else { $process.WaitForExit() }
        if ($process.ExitCode -ne 0) {
            throw "Capture process exited with code $($process.ExitCode); no trace was published."
        }
    } finally {
        if ($started -and -not $process.HasExited) {
            $process.Kill($true)
            $process.WaitForExit()
        }
        $process.Dispose()
    }
}

try {
    Write-Host 'Hardware Explorer Preview: capturing one local PE32 process and its loaded modules.'
    Write-Host 'No child-process following. Close the target normally to finish capture.'
    Invoke-CaptureProcess $pinPath (@('-t', $toolPath, '-o', $raw, '-max', "$MaxEvents",
        '-sample', "$SampleRate", '--', $programPath) + $ArgumentList) $TimeoutSeconds $workingPath
    if ((Get-FileHash -LiteralPath $programPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'The executable changed during capture.'
    }
    Invoke-CaptureProcess $normalizerPath @($raw, $temporary, $expectedHash) 120
    Move-Item -LiteralPath $temporary -Destination $outputPath -Force
    $succeeded = $true
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    if (Test-Path -LiteralPath $raw) {
        if ($succeeded) { Remove-Item -LiteralPath $raw -Force }
        else { Write-Warning "Incomplete raw capture preserved at '$raw'. No normalized trace was published." }
    }
}
Write-Host "Trace written to '$outputPath'. Cache metrics are modeled, not measured hardware counters."
