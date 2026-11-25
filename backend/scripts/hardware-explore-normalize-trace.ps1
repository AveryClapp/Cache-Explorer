# Convert a raw Windows clang-cl capture into portable trace format v2.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $RawTrace,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $Output,
    [ValidateRange(1, 2147483647)] [UInt32] $SampleRate = 1,
    [UInt64] $EventLimit = 0,
    [ValidatePattern('^[0-9a-fA-F]{64}$')] [string] $ExpectedImageSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'hardware-explorer-pe.ps1')

function Convert-HexUInt64 {
    param([Parameter(Mandatory = $true)] [string] $Value)

    if ($Value -notmatch '^0x[0-9a-fA-F]+$') {
        throw "Invalid hexadecimal value '$Value'."
    }
    return [Convert]::ToUInt64($Value.Substring(2), 16)
}

function Format-HexUInt64 {
    param([Parameter(Mandatory = $true)] [UInt64] $Value)
    return '0x{0:x}' -f $Value
}

$rawTracePath = (Resolve-Path -LiteralPath $RawTrace).Path
$imagePath = (Resolve-Path -LiteralPath $Image).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if ($rawTracePath -eq $outputPath) {
    throw 'RawTrace and Output must be different files.'
}
if ($imagePath -eq $outputPath) {
    throw 'Image and Output must be different files.'
}
$sizeOfImage = (Get-HardwareExplorerPeImage $imagePath).SizeOfImage
$sha256 = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedImageSha256 -and $sha256 -ne $ExpectedImageSha256) {
    throw 'The executable changed after capture started; refusing to bind code sites to a different image.'
}

$outputDirectory = [IO.Path]::GetDirectoryName($outputPath)
if (-not [string]::IsNullOrEmpty($outputDirectory)) {
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}

$eventPattern = '^(?<event>[LS] 0x[0-9a-fA-F]+ [0-9]+ \S+ T[0-9]+) C(?<pc>0x[0-9a-fA-F]+) B(?<base>0x[0-9a-fA-F]+) R(?<rva>0x[0-9a-fA-F]+)$'
$siteIds = [Collections.Generic.Dictionary[UInt64, UInt32]]::new()
$siteRvas = [Collections.Generic.List[UInt64]]::new()
[object] $loadedBase = $null
[UInt64] $eventCount = 0

$reader = [IO.StreamReader]::new($rawTracePath)
try {
  while ($null -ne ($line = $reader.ReadLine())) {
    if ($line -notmatch $eventPattern) {
        if ($line -match '^[LS] ') {
            throw "Malformed attributed event in '$rawTracePath': $line"
        }
        continue
    }

    $fields = $Matches
    $pc = Convert-HexUInt64 $fields.pc
    $base = Convert-HexUInt64 $fields.base
    $rva = Convert-HexUInt64 $fields.rva
    if ($pc -lt $base -or $pc - $base -ne $rva) {
        throw "Capture PC/base/RVA values are inconsistent: $line"
    }
    if ($null -eq $loadedBase) {
        $loadedBase = $base
    } elseif ([UInt64] $loadedBase -ne $base) {
        throw 'The raw trace contains multiple instrumented images. Multi-image normalization is not available yet.'
    }

    if (-not $siteIds.ContainsKey($rva)) {
        if ($siteIds.Count -ge 1000000) {
            throw 'The code-site table exceeds its 1000000-entry safety limit.'
        }
        $siteId = [UInt32] ($siteIds.Count + 1)
        $siteIds.Add($rva, $siteId)
        $siteRvas.Add($rva)
    }
    ++$eventCount
  }
} finally {
    $reader.Dispose()
}

if ($eventCount -eq 0 -or $null -eq $loadedBase) {
    throw "'$rawTracePath' does not contain attributed load/store events."
}

foreach ($rva in $siteRvas) {
    if ($rva -ge $sizeOfImage) {
        throw "Captured RVA $(Format-HexUInt64 $rva) falls outside the PE image."
    }
}
if ([UInt64] $loadedBase -ge 4294967296 -or
    [UInt64] $loadedBase + $sizeOfImage -gt 4294967296) {
    throw 'The loaded image address range exceeds the 32-bit address space.'
}
$endAddress = [UInt64] $loadedBase + $sizeOfImage
$imageName = [IO.Path]::GetFileName($imagePath).Replace('\', '\\').Replace('"', '\"')

$temporaryOutput = Join-Path $outputDirectory ".hardware-explorer-$([Guid]::NewGuid().ToString('N')).tmp"
$encoding = [Text.UTF8Encoding]::new($false)
$writer = [IO.StreamWriter]::new($temporaryOutput, $false, $encoding)
$reader = $null
try {
    $writer.WriteLine('# hardware-explorer-trace 2')
    $truncated = $EventLimit -gt 0 -and $eventCount -ge $EventLimit
    $writer.WriteLine(('# capture clang-cl i686-pc-windows-msvc 32 {0} {1} {2}' -f
        $SampleRate, $EventLimit, $truncated.ToString().ToLowerInvariant()))
    $writer.WriteLine(('# image 1 sha256:{0} "{1}" {2} {3}' -f $sha256,
        $imageName, (Format-HexUInt64 ([UInt64] $loadedBase)),
        (Format-HexUInt64 $endAddress)))
    foreach ($rva in $siteRvas) {
        $writer.WriteLine(('# site {0} 1 {1}' -f $siteIds[$rva],
            (Format-HexUInt64 $rva)))
    }

    $reader = [IO.StreamReader]::new($rawTracePath)
    while ($null -ne ($line = $reader.ReadLine())) {
        if ($line -match $eventPattern) {
            $eventText = $Matches.event
            $rva = Convert-HexUInt64 $Matches.rva
            $writer.WriteLine(('{0} K{1}' -f $eventText, $siteIds[$rva]))
        }
    }
} finally {
    if ($null -ne $reader) { $reader.Dispose() }
    $writer.Dispose()
}

Move-Item -LiteralPath $temporaryOutput -Destination $outputPath -Force
Write-Host "Normalized $eventCount events across $($siteIds.Count) code sites to '$outputPath'."
