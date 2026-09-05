#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)] [string] $PinRoot, [Parameter(Mandatory)] [string] $Toolchain)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Checked([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed: $LASTEXITCODE" }
}
function Assert-True([bool] $Condition, [string] $Message) { if (-not $Condition) { throw $Message } }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$root = Join-Path $env:RUNNER_TEMP "pin smoke café $([Guid]::NewGuid().ToString('N'))"
$simBuild = Join-Path $root 'simulator'
$fixture = Join-Path $root 'fixture'
$toolBuild = Join-Path $root 'tool'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Import-Module (Join-Path $vs 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
$clang = (Get-Command clang-cl).Source
Checked cmake @('-S', "$repo/backend/cache-simulator", '-B', $simBuild, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', "-DCMAKE_C_COMPILER=$clang", "-DCMAKE_CXX_COMPILER=$clang")
Checked cmake @('--build', $simBuild, '--target', 'hardware-explorer-normalize-pin', 'cache-sim', 'hardware-explorer-symbolize-pdb')
$normalizer = Join-Path $simBuild 'hardware-explorer-normalize-pin.exe'
& (Join-Path $PSScriptRoot 'test-normalizer.ps1') -Normalizer $normalizer

Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=x64'
& "$repo/backend/pin-tool/build-windows.ps1" -PinRoot $PinRoot -OutputDirectory $toolBuild `
    -Compiler (Join-Path $Toolchain 'bin/clang-cl.exe') -Linker (Join-Path $Toolchain 'bin/lld-link.exe')
Checked cmake @('-S', $PSScriptRoot, '-B', $fixture, '-G', 'Ninja', "-DCMAKE_C_COMPILER=$clang", '-DCMAKE_C_COMPILER_TARGET=i686-pc-windows-msvc')
Checked cmake @('--build', $fixture)
[IO.File]::WriteAllText((Join-Path $fixture 'fixture asset.txt'), 'relative-path game asset')
$program = Join-Path $fixture 'pin smoke.exe'
$plugin = Join-Path $fixture 'pin smoke plugin.dll'
$trace = Join-Path $root 'capture.txt'
$options = @{
    Program = $program; PinRoot = $PinRoot; PinTool = (Join-Path $toolBuild 'hardware_explorer_pin.dll')
    Normalizer = $normalizer; Output = $trace; TimeoutSeconds = 120
}
$arguments = @('--args', 'space value', 'ordinary-value', 'café', '--sample', '999', 'C:\plain\', 'C:\space folder\file.dat')
Push-Location $fixture
try { Checked $program $arguments }
finally { Pop-Location }
foreach ($badArgument in @('', 'quote"value', "line`nbreak", 'C:\space folder\')) {
    $rejected = $false
    try { & "$repo/backend/scripts/hardware-explore-pin.ps1" @options -ArgumentList @($badArgument) }
    catch {
        if ($_.Exception.Message -notmatch 'cannot safely forward') { throw }
        $rejected = $true
    }
    Assert-True ($rejected -and -not (Test-Path -LiteralPath $trace)) 'Unsafe argument was launched or published output.'
}
$badOutputOptions = $options.Clone()
$badOutputOptions.Output = $fixture
$rejected = $false
try { & "$repo/backend/scripts/hardware-explore-pin.ps1" @badOutputOptions }
catch {
    if ($_.Exception.Message -notmatch 'Output must be a file') { throw }
    $rejected = $true
}
Assert-True $rejected 'Allowed a directory as the trace output.'
& "$repo/backend/scripts/hardware-explore-pin.ps1" @options -ArgumentList $arguments
$lines = [IO.File]::ReadAllLines($trace)
$mainHash = (Get-FileHash -LiteralPath $program).Hash.ToLowerInvariant()
$dllHash = (Get-FileHash -LiteralPath $plugin).Hash.ToLowerInvariant()
Assert-True (@($lines -match "^# image .* sha256:$mainHash ").Count -eq 1) 'Load-time executable hash does not match .NET SHA256.'
Assert-True (@($lines -match "^# image .* sha256:$dllHash ").Count -eq 1) 'Loaded/reloaded DLL identity was lost or duplicated.'
Assert-True (@($lines -match '^L ').Count -gt 0 -and @($lines -match '^S ').Count -gt 0) 'Missing load/store events.'
$mainImageRecord = @($lines | Where-Object { $_ -match "^# image [0-9]+ sha256:$mainHash " })[0]
[void]($mainImageRecord -match '^# image ([0-9]+) ')
$mainId = $Matches[1]
$mainSites = @($lines -match "^# site [0-9]+ $mainId ")
Assert-True ($mainSites.Count -gt 0) 'Main executable never entered the capture window.'
$firstEvent = @($lines -match '^[LS] ')[0]
[void]($firstEvent -match ' K([0-9]+)$')
$firstSite = @($lines -match "^# site $($Matches[1]) $mainId ")
Assert-True ($firstSite.Count -eq 1) 'Capture did not start at the main executable entry point.'
$threadIds = @($lines | Where-Object { $_ -match ' T([0-9]+)' } | ForEach-Object { [void]($_ -match ' T([0-9]+)'); $Matches[1] } | Sort-Object -Unique)
Assert-True ($threadIds.Count -ge 4) 'Did not capture multiple application threads.'
Assert-True (-not ($lines -match ' [CI]0x|[A-Z]:\\')) 'Raw PCs or local paths leaked into portable records.'

$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = Join-Path $simBuild 'cache-sim.exe'
$start.ArgumentList.Add('--json'); $start.ArgumentList.Add('--config'); $start.ArgumentList.Add('intel')
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$process = [Diagnostics.Process]::Start($start)
$outTask = $process.StandardOutput.ReadToEndAsync(); $errorTask = $process.StandardError.ReadToEndAsync()
$file = [IO.File]::OpenRead($trace)
try { $file.CopyTo($process.StandardInput.BaseStream) } finally { $file.Dispose(); $process.StandardInput.Close() }
$process.WaitForExit()
Assert-True ($process.ExitCode -eq 0) "Simulator failed: $($errorTask.GetAwaiter().GetResult())"
$result = $outTask.GetAwaiter().GetResult() | ConvertFrom-Json
$process.Dispose()
Assert-True ($result.capture.kind -eq 'intel-pin' -and $result.capture.addressWidth -eq 32) 'Missing Pin capture provenance.'
Assert-True (@($result.codeHotspots | Where-Object { $_.location.imageId -eq "sha256:$mainHash" }).Count -gt 0) 'Main executable hotspots missing.'
Assert-True (@($result.codeHotspots | Where-Object { $_.location.imageId -eq "sha256:$dllHash" }).Count -gt 0) 'DLL hotspots missing.'
Assert-True (@($result.codeHotspots | Where-Object { $_.navigationConfidence -ne 'unresolved' }).Count -eq 0) 'Capture invented source-level confidence.'

# Enrich the EXE and then the DLL independently. Pin addresses must not be decremented.
$analysisPath = Join-Path $root 'analysis.json'
[IO.File]::WriteAllText($analysisPath, ($result | ConvertTo-Json -Depth 64))
$symbolOptions = @{ Symbolizer = (Join-Path $simBuild 'hardware-explorer-symbolize-pdb.exe') }
$exeResult = Join-Path $root 'exe-symbols.json'
$dllResult = Join-Path $root 'dll-symbols.json'
& "$repo/backend/scripts/hardware-explore-symbolize.ps1" @symbolOptions -Result $analysisPath -Image $program -Pdb (Join-Path $fixture 'pin smoke.pdb') -Output $exeResult
& "$repo/backend/scripts/hardware-explore-symbolize.ps1" @symbolOptions -Result $exeResult -Image $plugin -Pdb (Join-Path $fixture 'pin smoke plugin.pdb') -Output $dllResult
$enriched = [IO.File]::ReadAllText($dllResult) | ConvertFrom-Json
foreach ($hash in @($mainHash, $dllHash)) {
    $sites = @($enriched.codeHotspots | Where-Object { $_.location.imageId -eq "sha256:$hash" })
    Assert-True (@($sites | Where-Object { $_.navigationConfidence -eq 'source-nearest' }).Count -gt 0) 'Missing EXE/DLL source mapping.'
    foreach ($site in $sites) {
        Assert-True ($site.attribution.method -eq 'instruction-pc') 'Pin incorrectly used a return-PC lookup.'
        Assert-True ([Convert]::ToUInt32($site.location.rva.Substring(2), 16) -eq [Convert]::ToUInt32($site.attribution.lookupRva.Substring(2), 16)) 'Pin lookup decremented the instruction RVA.'
    }
}
Assert-True ($enriched.imageSymbolization.Count -eq 2) 'Multi-image attribution provenance lost.'
for ($index = 0; $index -lt $result.codeHotspots.Count; ++$index) {
    Assert-True (($result.codeHotspots[$index].metrics | ConvertTo-Json -Compress) -eq ($enriched.codeHotspots[$index].metrics | ConvertTo-Json -Compress)) 'Symbolization changed modeled metrics.'
}
$mismatched = $false
try { & "$repo/backend/scripts/hardware-explore-symbolize.ps1" @symbolOptions -Result $analysisPath -Image $plugin -Pdb (Join-Path $fixture 'pin smoke.pdb') -Output $dllResult }
catch { if ($_.Exception.Message -notmatch 'GUID/age') { throw }; $mismatched = $true }
Assert-True $mismatched 'Allowed a mismatched PDB for a DLL.'
Assert-True (([IO.File]::ReadAllText($dllResult) | ConvertFrom-Json).imageSymbolization.Count -eq 2) 'Failed enrichment damaged the previous result.'

# The no-debug-directory executable must retain attributed sites with no PDBs present.
$pdbs = Join-Path $root 'unused symbols'
[IO.Directory]::CreateDirectory($pdbs) | Out-Null
Get-ChildItem -LiteralPath $fixture -Filter '*.pdb' | Move-Item -Destination $pdbs
$strippedOptions = $options.Clone()
$strippedOptions.Program = Join-Path $fixture 'pin-smoke-stripped.exe'
& "$repo/backend/scripts/hardware-explore-pin.ps1" @strippedOptions
$strippedHash = (Get-FileHash -LiteralPath $strippedOptions.Program).Hash.ToLowerInvariant()
$stripped = [IO.File]::ReadAllLines($trace)
$strippedImage = @($stripped | Where-Object { $_ -match "^# image ([0-9]+) sha256:$strippedHash " })
Assert-True ($strippedImage.Count -eq 1) 'Stripped executable image missing.'
[void]($strippedImage[0] -match '^# image ([0-9]+) ')
Assert-True (@($stripped -match "^# site [0-9]+ $($Matches[1]) ").Count -gt 0) 'Stripped executable has no attributed code sites.'

# Alias, sampling and exactly enforced cross-thread limit.
& "$repo/backend/scripts/cache-explore-pin.ps1" @options -SampleRate 7 -MaxEvents 1000
$limited = [IO.File]::ReadAllLines($trace)
Assert-True ($limited[1] -eq '# capture intel-pin i686-pc-windows-msvc 32 7 1000 true') 'Missing sampling/limit provenance.'
Assert-True (@($limited -match '^[LS] ').Count -eq 1000) 'Sampling/event limit was not enforced exactly.'

foreach ($mode in @('--fail', '--crash', '--hang')) {
    [IO.File]::WriteAllText($trace, 'preserve existing output')
    $failed = $false; $warnings = @()
    $failureOptions = $options.Clone()
    if ($mode -eq '--hang') { $failureOptions.TimeoutSeconds = 10 }
    try { & "$repo/backend/scripts/hardware-explore-pin.ps1" @failureOptions -ArgumentList @($mode) -WarningVariable warnings }
    catch {
        $expectedFailure = if ($mode -eq '--hang') { 'timed out' }
            elseif ($mode -eq '--fail') { 'exited with code 17' } else { 'exited with code' }
        Assert-True ($_.Exception.Message -match $expectedFailure) "Unexpected failure: $_"
        $failed = $true
    }
    Assert-True ($failed -and [IO.File]::ReadAllText($trace) -eq 'preserve existing output') 'Failed capture overwrote output.'
    Assert-True (@($warnings | Where-Object { $_.ToString() -match 'raw capture preserved' }).Count -gt 0) 'Failed capture did not preserve diagnostics.'
}
$global:LASTEXITCODE = 0
Write-Host "Pin PE32 smoke passed: EXE and DLL hashes, code hotspots, $($threadIds.Count) threads, reload, argv, Unicode paths, sampling, limits and failures."
