[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $Simulator)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Trace {
    param([string] $Trace, [string] $Options = '--json')
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Simulator
    $info.Arguments = "--config intel --prefetch none $Options"
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($Trace)
        $process.StandardInput.Close()
        $process.WaitForExit()
        return [PSCustomObject]@{ Code = $process.ExitCode; Out = $stdout.Result; Error = $stderr.Result }
    } finally { $process.Dispose() }
}

$header = @(
    '# hardware-explorer-trace 2',
    '# capture clang-cl i686-pc-windows-msvc 32 1 2000000 false',
    ('# image 1 sha256:' + ('a' * 64) + ' "old game.exe" 0x400000 0x420000'),
    '# site 1 1 0x1234'
) -join "`n"
$events = "L 0x1000 4 unknown:0 T1 K1`nS 0x1000 4 unknown:0 T1 K1"
foreach ($options in @('--json', '--json --cache-segments', '--stream --cores 2')) {
    $result = Invoke-Trace "$header`n$events" $options
    if ($result.Code -ne 0) { throw "Analysis failed: $($result.Error) $($result.Out)" }
    $jsonText = if ($options -match 'stream') { ($result.Out.Trim() -split "`n")[-1] } else { $result.Out }
    $json = $jsonText | ConvertFrom-Json
    if ($options -match 'stream') {
        foreach ($line in ($result.Out.Trim() -split "`n")) { $line | ConvertFrom-Json | Out-Null }
        if ($json.cores -ne 2) { throw 'Streaming analysis ignored the requested core count.' }
    }
    if ($json.codeHotspots.Count -ne 1 -or $json.codeHotspots[0].metrics.accesses -ne 2 -or
        $json.codeHotspots[0].metrics.l1dMisses -ne 1 -or
        $json.codeHotspots[0].navigationConfidence -ne 'unresolved') {
        throw "Incorrect hotspots for $options."
    }
    if ($options -match 'cache-segments' -and $result.Error -notmatch 'segment caching is disabled') {
        throw 'Attributed traces silently used the segment-cache shortcut.'
    }
    $bad = Invoke-Trace "$header`nL 0xffffffff 4 unknown:0 T1 K1" $options
    if ($bad.Code -ne 2) { throw 'Malformed v2 trace did not fail with exit code 2.' }
    if ($options -match 'stream') {
        $errorJson = ($bad.Out.Trim() -split "`n")[-1] | ConvertFrom-Json
        if ($errorJson.type -ne 'error') { throw 'Streaming parser did not produce a structured error.' }
    } elseif ($bad.Out -ne '' -or $bad.Error -notmatch 'trace line') {
        throw 'Batch parser published results for a malformed trace.'
    }
}
$multi = Invoke-Trace "$header`n$($events.Replace('S 0x1000 4 unknown:0 T1', 'S 0x2000 4 unknown:0 T2'))"
$multiJson = $multi.Out | ConvertFrom-Json
if ($multi.Code -ne 0 -or $multiJson.codeHotspots[0].metrics.accesses -ne 2 -or
    $multiJson.codeHotspots[0].metrics.l1dMisses -ne 2) { throw 'Multi-core attribution was lost.' }

$legacyEvents = $events.Replace(' K1', '')
$legacy = Invoke-Trace $legacyEvents
$versioned = Invoke-Trace "$header`n$events"
$legacyJson = $legacy.Out | ConvertFrom-Json
$versionedJson = $versioned.Out | ConvertFrom-Json
if ($legacy.Code -ne 0 -or $legacyJson.PSObject.Properties.Name -contains 'codeHotspots' -or
    ($legacyJson.levels | ConvertTo-Json -Depth 10 -Compress) -cne
    ($versionedJson.levels | ConvertTo-Json -Depth 10 -Compress)) {
    throw 'Legacy cache-result compatibility changed.'
}
Write-Host 'Batch, streaming, multi-core, segment-cache fallback, malformed input, and legacy compatibility tests passed.'
