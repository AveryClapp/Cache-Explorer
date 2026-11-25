[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)] [string] $Program,
        [string[]] $Arguments
    )

    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& (Join-Path $PSScriptRoot 'test-normalizer.ps1')
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsInstall) {
    throw 'Visual Studio C++ build tools were not found.'
}

Import-Module (Join-Path $vsInstall 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsInstall -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'

$clangCl = (Get-Command clang-cl -ErrorAction Stop).Source

$buildRoot = Join-Path $env:RUNNER_TEMP "hardware-explorer-x86-$([guid]::NewGuid().ToString('N'))"
$simulatorBuild = Join-Path $buildRoot 'simulator'
$runtimeBuild = Join-Path $buildRoot 'runtime-x86'
$smokeBuild = Join-Path $buildRoot 'smoke-x86'

Invoke-Checked cmake @(
    '-S', (Join-Path $repositoryRoot 'backend\cache-simulator'), '-B', $simulatorBuild,
    '-G', 'Ninja', "-DCMAKE_C_COMPILER=$clangCl", "-DCMAKE_CXX_COMPILER=$clangCl",
    '-DBUILD_TESTING=ON'
)
Invoke-Checked cmake @('--build', $simulatorBuild, '--target', 'cache-sim', 'hardware-explorer-symbolize-pdb', 'TraceParserTest', 'JsonOutputTest', 'TraceProcessorTest')
foreach ($test in @('TraceParserTest', 'JsonOutputTest', 'TraceProcessorTest')) {
    Invoke-Checked (Join-Path $simulatorBuild "$test.exe")
}
& (Join-Path $PSScriptRoot 'test-simulator.ps1') -Simulator (Join-Path $simulatorBuild 'cache-sim.exe')

Enter-VsDevShell -VsInstallPath $vsInstall -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=x64'

Invoke-Checked cmake @(
    '-S', (Join-Path $repositoryRoot 'backend\runtime'), '-B', $runtimeBuild,
    '-G', 'Ninja', "-DCMAKE_C_COMPILER=$clangCl",
    '-DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc', '-DBUILD_TESTING=ON'
)
Invoke-Checked cmake @('--build', $runtimeBuild)
Invoke-Checked ctest @('--test-dir', $runtimeBuild, '--output-on-failure')

$runtime = Join-Path $runtimeBuild 'cache-explorer-rt.lib'
Invoke-Checked cmake @(
    '-S', $PSScriptRoot, '-B', $smokeBuild, '-G', 'Ninja',
    "-DCMAKE_C_COMPILER=$clangCl", '-DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc',
    "-DCACHE_EXPLORER_PATH=$repositoryRoot\backend",
    "-DCACHE_EXPLORER_RUNTIME=$runtime"
)
Invoke-Checked cmake @('--build', $smokeBuild)

$smokeBinary = Join-Path $smokeBuild 'hardware-explorer-x86-smoke.exe'
$binaryBytes = [System.IO.File]::ReadAllBytes($smokeBinary)
if ($binaryBytes.Length -lt 64) {
    throw 'The smoke executable is too small to contain a valid PE header.'
}
$peOffset = [BitConverter]::ToInt32($binaryBytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset + 6 -gt $binaryBytes.Length -or
    $binaryBytes[$peOffset] -ne 0x50 -or $binaryBytes[$peOffset + 1] -ne 0x45) {
    throw 'The smoke executable does not contain a valid PE header.'
}
$machine = [BitConverter]::ToUInt16($binaryBytes, $peOffset + 4)
if ($machine -ne 0x014c) {
    throw "The smoke executable machine is 0x$($machine.ToString('x4')); expected PE32 i386 (0x014c)."
}

$trace = Join-Path $buildRoot 'trace-v2.txt'
& (Join-Path $repositoryRoot 'backend\scripts\hardware-explore-run-x86.ps1') `
    -Program $smokeBinary -Output $trace

$traceLines = Get-Content -LiteralPath $trace
if ($traceLines[0] -ne '# hardware-explorer-trace 2') {
    throw 'The capture wrapper did not produce a trace v2 header.'
}
if (-not ($traceLines | Where-Object { $_ -match '^L 0x[0-9a-f]+ .* T[0-9]+ K[0-9]+$' })) {
    throw 'The normalized x86 trace did not contain attributed load events.'
}
if (-not ($traceLines | Where-Object { $_ -match '^S 0x[0-9a-f]+ .* T[0-9]+ K[0-9]+$' })) {
    throw 'The normalized x86 trace did not contain attributed store events.'
}
if ($traceLines | Where-Object { $_ -match ' [CBR]0x[0-9a-f]+' }) {
    throw 'The normalized trace leaked process-local capture addresses.'
}

$repeatTrace = Join-Path $buildRoot 'trace-v2-repeat.txt'
& (Join-Path $repositoryRoot 'backend\scripts\cache-explore-run-x86.ps1') `
    -Program $smokeBinary -Output $repeatTrace
$firstSites = @($traceLines | Where-Object { $_ -match '^# site ' })
$repeatSites = @(Get-Content -LiteralPath $repeatTrace | Where-Object { $_ -match '^# site ' })
if ($firstSites.Count -eq 0 -or
    (Compare-Object -ReferenceObject $firstSites -DifferenceObject $repeatSites)) {
    throw 'Code-site image/RVA identities changed across repeated ASLR-enabled runs.'
}

$failedOutput = Join-Path $buildRoot 'failed-run.txt'
[IO.File]::WriteAllText($failedOutput, 'existing output')
$captureWarnings = @()
$failedAsExpected = $false
$envBefore = @{}
foreach ($key in @('HARDWARE_EXPLORER_TRACE', 'HARDWARE_EXPLORER_SAMPLE_RATE', 'HARDWARE_EXPLORER_MAX_EVENTS')) {
    $envBefore[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
    & (Join-Path $repositoryRoot 'backend\scripts\hardware-explore-run-x86.ps1') `
        -Program $smokeBinary -ArgumentList @('--fail') -Output $failedOutput `
        -WarningVariable captureWarnings
} catch {
    if ($_.Exception.Message -notmatch 'target exited with code 17') { throw }
    $failedAsExpected = $true
}
if (-not $failedAsExpected -or [IO.File]::ReadAllText($failedOutput) -ne 'existing output') {
    throw 'Failed target execution published or overwrote a normalized trace.'
}
foreach ($key in $envBefore.Keys) {
    if ([Environment]::GetEnvironmentVariable($key, 'Process') -cne $envBefore[$key]) {
        throw "Capture did not restore $key."
    }
}
$preservedRaw = $null
foreach ($warning in $captureWarnings) {
    if ($warning.ToString() -match "raw capture preserved at '([^']+)'") { $preservedRaw = $Matches[1] }
}
if (-not $preservedRaw -or -not (Test-Path -LiteralPath $preservedRaw) -or
    (Get-Item -LiteralPath $preservedRaw).Length -eq 0) {
    throw 'Failed target execution did not preserve its raw capture.'
}
Remove-Item -LiteralPath $preservedRaw -Force
# The expected native exit code must not become the GitHub step's exit status.
$global:LASTEXITCODE = 0

$simulator = Join-Path $simulatorBuild 'cache-sim.exe'
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $simulator
$startInfo.Arguments = '--config intel --json'
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$simulatorProcess = [System.Diagnostics.Process]::new()
$simulatorProcess.StartInfo = $startInfo
[void]$simulatorProcess.Start()
foreach ($line in $traceLines) {
    $simulatorProcess.StandardInput.WriteLine($line)
}
$simulatorProcess.StandardInput.Close()
$resultText = $simulatorProcess.StandardOutput.ReadToEnd()
$simulatorError = $simulatorProcess.StandardError.ReadToEnd()
$simulatorProcess.WaitForExit()
if ($simulatorProcess.ExitCode -ne 0) {
    throw "cache-sim failed with exit code $($simulatorProcess.ExitCode): $simulatorError"
}

$result = $resultText | ConvertFrom-Json
$l1dAccesses = $result.levels.l1d.hits + $result.levels.l1d.misses
if ($l1dAccesses -le 0) {
    throw 'cache-sim reported no L1 data-cache accesses for the x86 trace.'
}
if ($result.capture.traceFormat -ne 2 -or $result.capture.kind -ne 'clang-cl' -or
    $result.capture.addressWidth -ne 32 -or $result.capture.sampleRate -ne 1 -or
    $result.images.Count -ne 1 -or
    $result.codeHotspots.Count -le 0) {
    throw 'cache-sim did not expose v2 capture provenance and code hotspots.'
}
if ($result.codeHotspots | Where-Object { $_.navigationConfidence -ne 'unresolved' }) {
    throw 'Unresolved code sites were presented as verified source/decompiler navigation.'
}

$analysisFile = Join-Path $buildRoot 'analysis.json'
[IO.File]::WriteAllText($analysisFile, $resultText, [Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot 'test-symbolizer.ps1') -Result $analysisFile -Image $smokeBinary `
    -Pdb (Join-Path $smokeBuild 'hardware-explorer-x86-smoke.pdb') `
    -WrongImage (Join-Path $smokeBuild 'hardware-explorer-pdb-mismatch.exe') `
    -WrongPdb (Join-Path $smokeBuild 'hardware-explorer-pdb-mismatch.pdb') `
    -Symbolizer (Join-Path $simulatorBuild 'hardware-explorer-symbolize-pdb.exe')

Write-Host "Windows x86 clang-cl attribution smoke passed with $l1dAccesses L1D accesses and $($result.codeHotspots.Count) code hotspots."
