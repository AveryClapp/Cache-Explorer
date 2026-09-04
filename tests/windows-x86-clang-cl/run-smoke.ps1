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
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsInstall) {
    throw 'Visual Studio C++ build tools were not found.'
}

Import-Module (Join-Path $vsInstall 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsInstall -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'

$clangCl = (Get-Command clang-cl -ErrorAction Stop).Source
$llvmRoot = Split-Path -Parent (Split-Path -Parent $clangCl)
$llvmCMake = Join-Path $llvmRoot 'lib\cmake\llvm'
if (-not (Test-Path -LiteralPath (Join-Path $llvmCMake 'LLVMConfig.cmake'))) {
    throw "LLVMConfig.cmake was not found under $llvmCMake"
}

$buildRoot = Join-Path $env:RUNNER_TEMP "hardware-explorer-x86-$([guid]::NewGuid().ToString('N'))"
$passBuild = Join-Path $buildRoot 'pass'
$simulatorBuild = Join-Path $buildRoot 'simulator'
$runtimeBuild = Join-Path $buildRoot 'runtime-x86'
$smokeBuild = Join-Path $buildRoot 'smoke-x86'

Invoke-Checked cmake @(
    '-S', (Join-Path $repositoryRoot 'backend\llvm-pass'), '-B', $passBuild,
    '-G', 'Ninja', '-DCMAKE_C_COMPILER=clang-cl', '-DCMAKE_CXX_COMPILER=clang-cl',
    "-DLLVM_DIR=$llvmCMake"
)
Invoke-Checked cmake @('--build', $passBuild)

Invoke-Checked cmake @(
    '-S', (Join-Path $repositoryRoot 'backend\cache-simulator'), '-B', $simulatorBuild,
    '-G', 'Ninja', '-DCMAKE_CXX_COMPILER=clang-cl', '-DBUILD_TESTING=OFF'
)
Invoke-Checked cmake @('--build', $simulatorBuild, '--target', 'cache-sim')

Enter-VsDevShell -VsInstallPath $vsInstall -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=x64'

Invoke-Checked cmake @(
    '-S', (Join-Path $repositoryRoot 'backend\runtime'), '-B', $runtimeBuild,
    '-G', 'Ninja', '-DCMAKE_C_COMPILER=clang-cl',
    '-DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc', '-DBUILD_TESTING=ON'
)
Invoke-Checked cmake @('--build', $runtimeBuild)
Invoke-Checked ctest @('--test-dir', $runtimeBuild, '--output-on-failure')

$pass = Join-Path $passBuild 'CacheProfiler.dll'
$runtime = Join-Path $runtimeBuild 'cache-explorer-rt.lib'
Invoke-Checked cmake @(
    '-S', $PSScriptRoot, '-B', $smokeBuild, '-G', 'Ninja',
    '-DCMAKE_C_COMPILER=clang-cl', '-DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc',
    "-DCACHE_EXPLORER_PATH=$repositoryRoot\backend",
    "-DCACHE_EXPLORER_PASS=$pass", "-DCACHE_EXPLORER_RUNTIME=$runtime"
)
Invoke-Checked cmake @('--build', $smokeBuild)

$smokeBinary = Join-Path $smokeBuild 'hardware-explorer-x86-smoke.exe'
$headers = & dumpbin /headers $smokeBinary
if ($headers -notmatch '14C machine \(x86\)') {
    throw 'The smoke executable is not a Windows x86 binary.'
}

$trace = Join-Path $buildRoot 'trace.txt'
$progress = Join-Path $buildRoot 'progress.txt'
$smokeProcess = Start-Process -FilePath $smokeBinary -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $trace -RedirectStandardError $progress
if ($smokeProcess.ExitCode -ne 0) {
    throw "The instrumented x86 executable failed with exit code $($smokeProcess.ExitCode)."
}

$traceLines = Get-Content -LiteralPath $trace
if (-not ($traceLines | Where-Object { $_ -match '^[LSI] 0x[0-9a-f]+ ' })) {
    throw 'The instrumented x86 executable did not emit cache trace events.'
}

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

Write-Host "Windows x86 clang-cl smoke passed with $l1dAccesses L1D accesses."
