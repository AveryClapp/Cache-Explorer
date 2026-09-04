#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Result,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $Pdb,
    [Parameter(Mandatory = $true)] [string] $WrongImage,
    [Parameter(Mandatory = $true)] [string] $WrongPdb,
    [Parameter(Mandatory = $true)] [string] $Symbolizer
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scripts = Join-Path $PSScriptRoot '../../backend/scripts'
$command = Join-Path $scripts 'hardware-explore-symbolize.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "hardware-explorer-pdb-test-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
function Assert-Fails {
    param([scriptblock] $Action, [string] $Pattern)
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        return
    }
    throw "Expected failure matching '$Pattern'."
}
function Write-Analysis {
    param([object] $Data, [string] $Path)
    [IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth 64), [Text.UTF8Encoding]::new($false))
}
try {
    $output = Join-Path $testRoot 'enriched.json'
    & $command -Result $Result -Image $Image -Pdb $Pdb -Output $output -Symbolizer $Symbolizer -Verbose
    $before = [IO.File]::ReadAllText($Result) | ConvertFrom-Json -AsHashtable
    $after = [IO.File]::ReadAllText($output) | ConvertFrom-Json -AsHashtable
    if ($after.symbolization.sourceSites -lt 1 -or $after.symbolization.functionSites -lt 1 -or
        $after.images[0].codeView.guid -notmatch '^[0-9a-f-]{36}$') {
        throw 'The matching PDB did not resolve functions/source locations.'
    }
    if (($before.levels | ConvertTo-Json -Depth 10 -Compress) -cne
        ($after.levels | ConvertTo-Json -Depth 10 -Compress)) { throw 'Symbolization changed modeled cache metrics.' }
    $foundMix = $false
    for ($i = 0; $i -lt $before.codeHotspots.Count; ++$i) {
        $old = $before.codeHotspots[$i]
        $new = $after.codeHotspots[$i]
        foreach ($field in @('location', 'metrics')) {
            if (($old[$field] | ConvertTo-Json -Compress) -cne ($new[$field] | ConvertTo-Json -Compress)) {
                throw "Symbolization changed $field."
            }
        }
        if ($new.navigationConfidence -in @('source-exact', 'instruction-exact', 'pseudocode-nearest')) {
            throw 'PDB lookup overstated statement/decompiler precision.'
        }
        if ($new.navigationConfidence -eq 'source-nearest') {
            if ($new.source.file -notmatch 'smoke\.c$' -or $new.source.line -lt 1 -or
                $new.attribution.method -ne 'return-pc-minus-one') { throw 'Incorrect source attribution.' }
            if ($new.symbol.function -match 'mix_values' -and $new.source.line -ge 6 -and $new.source.line -le 14) {
                $foundMix = $true
            }
        }
    }
    if (-not $foundMix) { throw 'No captured access resolved to mix_values in smoke.c.' }

    # Explicit local PDB selection, independent of its original embedded path.
    $relocated = Join-Path $testRoot 'local symbols with spaces'
    [IO.Directory]::CreateDirectory($relocated) | Out-Null
    $localImage = Join-Path $relocated 'old game.exe'
    $localPdb = Join-Path $relocated 'renamed symbols.pdb'
    Copy-Item -LiteralPath $Image -Destination $localImage
    Copy-Item -LiteralPath $Pdb -Destination $localPdb
    $repeat = Join-Path $testRoot 'repeat.json'
    & (Join-Path $scripts 'cache-explore-symbolize.ps1') -Result $Result -Image $localImage `
        -Pdb $localPdb -Output $repeat -Symbolizer $Symbolizer
    $repeatData = [IO.File]::ReadAllText($repeat) | ConvertFrom-Json -AsHashtable
    if (($after.codeHotspots | ConvertTo-Json -Depth 10 -Compress) -cne
        ($repeatData.codeHotspots | ConvertTo-Json -Depth 10 -Compress)) {
        throw 'Relocating/renaming the exact executable and PDB changed attribution.'
    }

    [IO.File]::WriteAllText($output, 'existing output')
    Assert-Fails { & $command -Result $Result -Image $Image -Pdb $WrongPdb -Output $output -Symbolizer $Symbolizer } 'PDB GUID/age'
    Assert-Fails { & $command -Result $Result -Image $WrongImage -Pdb $WrongPdb -Output $output -Symbolizer $Symbolizer } 'SHA-256'
    $invalidPdb = Join-Path $testRoot 'invalid.pdb'
    [IO.File]::WriteAllText($invalidPdb, 'not a PDB')
    Assert-Fails { & $command -Result $Result -Image $Image -Pdb $invalidPdb -Output $output -Symbolizer $Symbolizer } 'CodeView/PDB identity'
    Assert-Fails { & $command -Result $Result -Image $Image -Pdb (Join-Path $testRoot 'missing.pdb') -Output $output -Symbolizer $Symbolizer } 'does not exist'
    Assert-Fails { & $command -Result $Result -Image $Image -Pdb $Pdb -Output $Image -Symbolizer $Symbolizer } 'different file'
    Assert-Fails { & $command -Result $Result -Image $Image -Pdb $Pdb -Output $Result -Symbolizer $Symbolizer } 'different file'
    $badResult = Join-Path $testRoot 'bad-result.json'
    $before.capture.kind = 'intel-pin'
    Write-Analysis $before $badResult
    Assert-Fails { & $command -Result $badResult -Image $Image -Pdb $Pdb -Output $output -Symbolizer $Symbolizer } 'completed clang-cl'
    $before.capture.kind = 'clang-cl'
    $before.codeHotspots[0].location.rva = '0xffffffff'
    Write-Analysis $before $badResult
    Assert-Fails { & $command -Result $badResult -Image $Image -Pdb $Pdb -Output $output -Symbolizer $Symbolizer } 'outside'
    $before.codeHotspots[0].location.rva = '-1'
    Write-Analysis $before $badResult
    Assert-Fails { & $command -Result $badResult -Image $Image -Pdb $Pdb -Output $output -Symbolizer $Symbolizer } 'Invalid PE32'
    if ([IO.File]::ReadAllText($output) -ne 'existing output') { throw 'A failed lookup overwrote output.' }

    # A valid in-image address without debug attribution remains explicitly unresolved.
    $before.codeHotspots = @($before.codeHotspots[0])
    $before.codeHotspots[0].location.rva = '0x1'
    $before.codeHotspots[0].symbol = @{ function = 'stale'; functionRva = '0x1' }
    $before.codeHotspots[0].source = @{ file = 'stale.c'; line = 1 }
    Write-Analysis $before $badResult
    & $command -Result $badResult -Image $Image -Pdb $Pdb -Output $output -Symbolizer $Symbolizer
    $unresolved = [IO.File]::ReadAllText($output) | ConvertFrom-Json -AsHashtable
    if ($unresolved.codeHotspots[0].navigationConfidence -ne 'unresolved' -or
        $unresolved.codeHotspots[0].Contains('source') -or $unresolved.codeHotspots[0].Contains('symbol')) {
        throw 'Unresolved lookup retained stale attribution.'
    }
    Write-Host 'PDB function/source lookup, identity rejection, aliases, relocated files, metric preservation, and unresolved fallback passed.'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
