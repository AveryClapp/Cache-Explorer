#requires -Version 7.2
# Enrich one SHA-selected image in a completed analysis; never execute it.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Result,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $Pdb,
    [Parameter(Mandatory = $true)] [string] $Output,
    [string] $Symbolizer = (Join-Path $PSScriptRoot '../cache-simulator/build/hardware-explorer-symbolize-pdb.exe'),
    [ValidateRange(1, 300)] [int] $TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'hardware-explorer-pe.ps1')

$resultPath = (Resolve-Path -LiteralPath $Result).Path
$imagePath = (Resolve-Path -LiteralPath $Image).Path
$pdbPath = (Resolve-Path -LiteralPath $Pdb).Path
$symbolizerPath = (Resolve-Path -LiteralPath $Symbolizer).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if ($outputPath -in @($resultPath, $imagePath, $pdbPath, $symbolizerPath)) {
    throw 'Output must be a different file from Result, Image, Pdb, and Symbolizer.'
}
if ((Get-Item -LiteralPath $resultPath).Length -gt 16MB) {
    throw 'Analysis result exceeds the 16 MiB safety limit.'
}
$analysis = [IO.File]::ReadAllText($resultPath) | ConvertFrom-Json -AsHashtable -Depth 64
if ($analysis -isnot [Collections.IDictionary] -or
    $analysis.capture -isnot [Collections.IDictionary] -or
    $analysis.capture.traceFormat -ne 2 -or $analysis.capture.kind -notin @('clang-cl', 'intel-pin') -or
    $analysis.capture.addressWidth -ne 32 -or
    $analysis.images -isnot [Collections.IList] -or $analysis.images.Count -lt 1 -or $analysis.images.Count -gt 4096 -or
    $analysis.codeHotspots -isnot [Collections.IList] -or
    $analysis.codeHotspots.Count -lt 1 -or $analysis.codeHotspots.Count -gt 10000) {
    throw 'Expected a completed clang-cl or Intel Pin PE32 analysis with 1–10000 code hotspots.'
}
$instructionPc = $analysis.capture.kind -eq 'intel-pin'
$lookupMethod = if ($instructionPc) { 'instruction-pc' } else { 'return-pc-minus-one' }
$peSize = (Get-HardwareExplorerPeImage $imagePath -AllowDll:$instructionPc).SizeOfImage
$imageHash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$pdbHash = (Get-FileHash -LiteralPath $pdbPath -Algorithm SHA256).Hash.ToLowerInvariant()
$imageId = "sha256:$imageHash"
$selectedImages = @($analysis.images | Where-Object { $_.id -eq $imageId -and $_.sha256 -eq $imageHash })
if ($selectedImages.Count -ne 1) {
    throw 'The executable SHA-256 does not match the captured image.'
}

function Convert-SiteRva {
    param([object] $Value)
    if ($Value -isnot [string] -or $Value -notmatch '^0x[0-9a-fA-F]{1,8}$') {
        throw 'Invalid PE32 code-site RVA.'
    }
    $rva = [Convert]::ToUInt32($Value.Substring(2), 16)
    if ((-not $instructionPc -and $rva -eq 0) -or $rva -ge $peSize) { throw 'Code-site RVA falls outside the executable.' }
    return '0x{0:x}' -f $rva
}

$rvas = [Collections.Generic.HashSet[string]]::new()
foreach ($hotspot in $analysis.codeHotspots) {
    if ($hotspot -isnot [Collections.IDictionary] -or
        $hotspot.location -isnot [Collections.IDictionary] -or
        $hotspot.location.imageId -notin $analysis.images.id) {
        throw 'A hotspot refers to an unexpected image.'
    }
    if ($hotspot.location.imageId -eq $imageId) { [void] $rvas.Add((Convert-SiteRva $hotspot.location.rva)) }
}
if ($rvas.Count -eq 0) { throw 'The selected image has no exported code hotspots to symbolize.' }

$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $symbolizerPath
$start.ArgumentList.Add($imagePath)
$start.ArgumentList.Add($pdbPath)
if ($instructionPc) { $start.ArgumentList.Add('instruction-pc') }
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false, $true)
$start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false, $true)
# No inherited symbol-server configuration, including in a future helper version.
foreach ($key in @('_NT_SYMBOL_PATH', '_NT_ALT_SYMBOL_PATH', 'DEBUGINFOD_URLS')) {
    [void] $start.Environment.Remove($key)
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
$started = $false
try {
    [void] $process.Start()
    $started = $true
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $writeFailure = $null
    $writeTimedOut = $false
    try {
        $write = $process.StandardInput.WriteAsync(($rvas -join "`n") + "`n")
        $writeTimedOut = -not $write.Wait($TimeoutSeconds * 1000)
    } catch {
        # A rejected PDB can make the helper exit before it reads stdin. Keep
        # its useful diagnostic instead of masking it with a broken-pipe error.
        $writeFailure = $_
    }
    if ($writeTimedOut) {
        $process.Kill($true)
        throw 'PDB symbolization timed out while sending code sites.'
    }
    try { $process.StandardInput.Close() } catch { $writeFailure = $_ }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        throw 'PDB symbolization timed out.'
    }
    if ($process.ExitCode -ne 0) {
        throw "PDB symbolization failed: $($stderr.Result.Trim())"
    }
    if ($null -ne $writeFailure) { throw "Could not send code sites: $($writeFailure.Exception.Message)" }
    if ($stderr.Result) { Write-Verbose $stderr.Result.Trim() }
    $symbolText = $stdout.Result
} finally {
    if ($started -and -not $process.HasExited) { $process.Kill($true) }
    $process.Dispose()
}

if ($symbolText.Length -gt 64MB) { throw 'Symbol results exceed the safety limit.' }
$records = @($symbolText.Trim() -split '\r?\n')
if ($records.Count -ne $rvas.Count + 1) { throw 'The symbolizer returned an incomplete result.' }
$metadata = $records[0] | ConvertFrom-Json -AsHashtable -Depth 8
if ($metadata.type -ne 'symbols' -or $metadata.format -ne 1 -or
    $metadata.provider -ne 'dbghelp' -or $metadata.lookupMethod -ne $lookupMethod -or
    $metadata.imageSize -ne $peSize -or
    $metadata.guid -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
    $metadata.age -isnot [long] -or $metadata.age -lt 0 -or $metadata.age -gt [UInt32]::MaxValue) {
    throw 'The symbolizer returned invalid PDB identity metadata.'
}
$sites = @{}
foreach ($record in $records[1..($records.Count - 1)]) {
    $site = $record | ConvertFrom-Json -AsHashtable -Depth 8
    $rva = Convert-SiteRva $site.rva
    $lookupRva = if ($instructionPc) { $rva } else { '0x{0:x}' -f ([Convert]::ToUInt32($rva.Substring(2), 16) - 1) }
    if ($site.type -ne 'site' -or -not $rvas.Contains($rva) -or $sites.ContainsKey($rva) -or
        $site.lookupRva -ne $lookupRva -or
        $site.navigationConfidence -notin @('unresolved', 'function-exact', 'source-nearest')) {
        throw 'The symbolizer returned an invalid or duplicate code site.'
    }
    if ($site.navigationConfidence -ne 'unresolved') {
        if ($site.symbol -isnot [Collections.IDictionary] -or
            $site.symbol.function -isnot [string] -or [string]::IsNullOrEmpty($site.symbol.function) -or
            $site.symbol.function.Length -gt 4096) { throw 'Invalid function mapping.' }
        $functionRva = Convert-SiteRva $site.symbol.functionRva
        if ([Convert]::ToUInt32($functionRva.Substring(2), 16) -gt
            [Convert]::ToUInt32($lookupRva.Substring(2), 16)) { throw 'Invalid function address range.' }
    }
    if ($site.navigationConfidence -eq 'source-nearest' -and
        ($site.source -isnot [Collections.IDictionary] -or $site.source.file -isnot [string] -or
         [string]::IsNullOrEmpty($site.source.file) -or $site.source.file.Length -gt 4096 -or
         $site.source.line -isnot [long] -or $site.source.line -lt 1 -or
         $site.source.line -gt [UInt32]::MaxValue)) { throw 'Invalid source mapping.' }
    $sites[$rva] = $site
}

# Fail closed if either selected file changed while the native helper read it.
if ((Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash -ne $imageHash -or
    (Get-FileHash -LiteralPath $pdbPath -Algorithm SHA256).Hash -ne $pdbHash) {
    throw 'The executable or PDB changed during symbolization.'
}
$selectedImages[0].codeView = @{ guid = $metadata.guid; age = $metadata.age }
$sourceCount = 0
$functionCount = 0
foreach ($hotspot in $analysis.codeHotspots) {
    if ($hotspot.location.imageId -ne $imageId) { continue }
    $site = $sites[(Convert-SiteRva $hotspot.location.rva)]
    [void] $hotspot.Remove('symbol')
    [void] $hotspot.Remove('source')
    $hotspot.navigationConfidence = $site.navigationConfidence
    $hotspot.attribution = @{ provider = 'pdb'; lookupRva = $site.lookupRva; method = $metadata.lookupMethod }
    if ($site.navigationConfidence -ne 'unresolved') {
        $hotspot.symbol = $site.symbol
        ++$functionCount
    }
    if ($site.navigationConfidence -eq 'source-nearest') {
        $hotspot.source = $site.source
        ++$sourceCount
    }
}
$summary = @{
    imageId = $imageId
    provider = 'dbghelp'; pdbSha256 = $pdbHash; sourceSites = $sourceCount
    functionSites = $functionCount; unresolvedSites = $rvas.Count - $functionCount
    sourceMapping = if ($instructionPc) { 'nearest-debug-line-to-instruction' } else { 'nearest-debug-line-to-instrumentation-call' }
}
$analysis.symbolization = $summary # Compatibility: most recently enriched image.
$previous = if ($analysis.ContainsKey('imageSymbolization')) { @($analysis.imageSymbolization | Where-Object { $_.imageId -ne $imageId }) } else { @() }
$analysis.imageSymbolization = @($previous) + @($summary)
$outputDirectory = [IO.Path]::GetDirectoryName($outputPath)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$temporary = Join-Path $outputDirectory ".hardware-explorer-symbols-$([Guid]::NewGuid().ToString('N')).tmp"
try {
    [IO.File]::WriteAllText($temporary, ($analysis | ConvertTo-Json -Depth 64), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $outputPath -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
Write-Host "Resolved $functionCount function sites and $sourceCount approximate source locations to '$outputPath'."
