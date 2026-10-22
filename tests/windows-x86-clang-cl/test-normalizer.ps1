# Portable tests: these synthetic PE headers are never executed.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scripts = Join-Path $PSScriptRoot '../../backend/scripts'
$normalizer = Join-Path $scripts 'hardware-explore-normalize-trace.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "hardware-explorer-normalizer-test-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($testRoot) | Out-Null

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Fails {
    param([scriptblock] $Action, [string] $Pattern)
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        return
    }
    throw "Expected failure matching '$Pattern'."
}

function Write-TestImage {
    param([string] $Path, [UInt16] $Machine = 0x014c,
          [UInt16] $Magic = 0x10b, [UInt16] $Characteristics = 0x0102)
    $stream = [IO.File]::Create($Path)
    $writer = [IO.BinaryWriter]::new($stream)
    try {
        $stream.SetLength(512)
        $writer.Write([UInt16] 0x5a4d)
        $stream.Position = 0x3c
        $writer.Write([UInt32] 0x80)
        $stream.Position = 0x80
        $writer.Write([UInt32] 0x4550)
        $writer.Write($Machine)
        $stream.Position = 0x80 + 20
        $writer.Write([UInt16] 224)
        $writer.Write($Characteristics)
        $writer.Write($Magic)
        $stream.Position = 0x80 + 24 + 56
        $writer.Write([UInt32] 0x20000)
    } finally { $writer.Dispose() }
}

try {
    $image = Join-Path $testRoot 'old game.exe'
    $raw = Join-Path $testRoot 'capture.raw'
    $output = Join-Path $testRoot 'normalized.txt'
    Write-TestImage $image
    $hash = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant()
    $rawLines = @(
        'L 0x1000 4 unknown:0 T1 C0x401234 B0x400000 R0x1234',
        'S 0x1004 4 unknown:0 T1 C0x401238 B0x400000 R0x1238',
        'L 0x1000 4 unknown:0 T1 C0x401234 B0x400000 R0x1234'
    )
    [IO.File]::WriteAllLines($raw, $rawLines)
    & $normalizer -RawTrace $raw -Image $image -Output $output -EventLimit 3 -ExpectedImageSha256 $hash
    $first = [IO.File]::ReadAllLines($output)
    Assert-True ($first[0] -eq '# hardware-explorer-trace 2') 'Missing v2 header.'
    Assert-True ($first[1] -eq '# capture clang-cl i686-pc-windows-msvc 32 1 3 true') 'Missing capture provenance/limit.'
    Assert-True ($first[2] -eq "# image 1 sha256:$hash `"old game.exe`" 0x400000 0x420000") 'Incorrect image identity or quoting.'
    Assert-True ($first[3] -eq '# site 1 1 0x1234' -and $first[4] -eq '# site 2 1 0x1238') 'Incorrect site table.'
    Assert-True ($first[5] -eq 'L 0x1000 4 unknown:0 T1 K1' -and $first[7] -eq $first[5]) 'Incorrect event attribution.'

    # Explicitly move the image base, unlike repeated launches which may reuse it.
    [IO.File]::WriteAllLines($raw, ($rawLines -replace '0x40', '0x71'))
    & (Join-Path $scripts 'cache-explore-normalize-trace.ps1') -RawTrace $raw -Image $image -Output $output -EventLimit 3
    $second = [IO.File]::ReadAllLines($output)
    Assert-True ($second[2] -match '0x710000 0x730000$') 'ASLR fixture did not move.'
    Assert-True (-not (Compare-Object $first[3..7] $second[3..7])) 'Site identities changed under ASLR.'

    [IO.File]::WriteAllText($output, 'preserve existing output')
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output -ExpectedImageSha256 ('b' * 64) } 'executable changed'
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $raw } 'different files'
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $image } 'different files'
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output -SampleRate 0 } 'validation|range'

    foreach ($case in @(
        @{ Line = 'L 0x1000 4 unknown:0 T1 C0x401235 B0x400000 R0x1234'; Error = 'inconsistent' },
        @{ Line = 'L 0x1000 4 unknown:0 T1 C0x420000 B0x400000 R0x20000'; Error = 'outside' },
        @{ Line = 'L 0x1000 4 unknown:0 T1 C0x100001234 B0x100000000 R0x1234'; Error = '32-bit' },
        @{ Line = 'L 0x1000 4 unknown:0 T1 C0x401234'; Error = 'Malformed' },
        @{ Line = 'no capture'; Error = 'does not contain' }
    )) {
        [IO.File]::WriteAllText($raw, $case.Line)
        Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } $case.Error
    }
    [IO.File]::WriteAllLines($raw, @($rawLines[0], ($rawLines[1] -replace '0x40', '0x71')))
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } 'multiple instrumented images'

    [IO.File]::WriteAllLines($raw, $rawLines)
    Write-TestImage $image -Machine 0x8664 -Magic 0x20b
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } 'x86 PE32'
    Assert-Fails { & (Join-Path $scripts 'hardware-explore-run-x86.ps1') -Program $image -Output $output } 'x86 PE32'
    Write-TestImage $image -Magic 0x20b
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } 'optional header'
    Write-TestImage $image -Characteristics 0x2102
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } 'not a DLL'
    [IO.File]::WriteAllBytes($image, [byte[]]::new(63))
    Assert-Fails { & $normalizer -RawTrace $raw -Image $image -Output $output } 'DOS/PE header'
    Assert-True ([IO.File]::ReadAllText($output) -eq 'preserve existing output') 'A failed normalization overwrote output.'
    Write-Host 'PE32 validation, trace normalization, aliases, failure preservation, and ASLR identity tests passed.'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
