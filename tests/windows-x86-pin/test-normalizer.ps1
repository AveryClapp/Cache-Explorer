# Portable format tests. These synthetic records never execute a target binary.
#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)] [string] $Normalizer)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version Latest
$root = Join-Path ([IO.Path]::GetTempPath()) "hardware-explorer-pin-test-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($root) | Out-Null
$raw = Join-Path $root 'raw capture.txt'
$output = Join-Path $root 'normalized café.txt'
$hash = 'a' * 64
$dllHash = 'b' * 64
function Name-Hex([string] $Name) { [Convert]::ToHexString([Text.Encoding]::UTF8.GetBytes($Name)).ToLowerInvariant() }
function Assert-True([bool] $Condition, [string] $Message) { if (-not $Condition) { throw $Message } }
$header = '# hardware-explorer-pin-raw 1 32 1 100'
$main = "# image 10 $hash $(Name-Hex 'game.exe') 0x400000 0x420000 1"
$dll = "# image 20 $dllHash $(Name-Hex 'plugin café.dll') 0x710000 0x730000 0"
$load = 'L 0x1000 4 T0 C0x401234 I10'
$store = 'S 0x1004 4 T1 C0x711234 I20'
$end = '# end 2 0 0'
$valid = @($header, $main, $load, $dll, $store, $end)
function Convert-Raw([string[]] $Lines, [string] $ErrorPattern = '') {
    [IO.File]::WriteAllLines($raw, $Lines, [Text.UTF8Encoding]::new($false))
    if ($ErrorPattern) { [IO.File]::WriteAllText($output, 'preserve output') }
    $message = (& $Normalizer $raw $output $hash 2>&1 | Out-String)
    if ($ErrorPattern) {
        Assert-True ($LASTEXITCODE -ne 0 -and $message -match $ErrorPattern) "Expected '$ErrorPattern', got: $message"
        Assert-True ([IO.File]::ReadAllText($output) -eq 'preserve output') 'Failed validation overwrote existing output.'
    } else {
        Assert-True ($LASTEXITCODE -eq 0) "Normalization failed: $message"
    }
}
try {
    Convert-Raw $valid
    $lines = [IO.File]::ReadAllLines($output)
    Assert-True ($lines[1] -eq '# capture intel-pin i686-pc-windows-msvc 32 1 100 false') 'Incorrect capture provenance.'
    Assert-True ($lines[2] -match 'sha256:a{64} "game.exe"') 'Missing main image identity.'
    Assert-True ($lines[3] -match 'sha256:b{64} "plugin café.dll"') 'Missing DLL identity or UTF8 name.'
    Assert-True ($lines[4] -eq '# site 1 1 0x1234' -and $lines[5] -eq '# site 2 2 0x1234') 'Images with equal RVAs were conflated.'
    Assert-True ($lines[6] -eq 'L 0x1000 4 unknown:0 T0 K1' -and $lines[7] -eq 'S 0x1004 4 unknown:0 T1 K2') 'Wrong thread/data/site preservation.'
    $baseline = $lines[4..7]

    Convert-Raw ($valid -replace '0x40', '0x50' -replace '0x42', '0x52' -replace '0x71', '0x61' -replace '0x73', '0x63')
    Assert-True (-not (Compare-Object $baseline ([IO.File]::ReadAllLines($output)[4..7]))) 'ASLR changed stable code sites.'

    # A reloaded module gets a new Pin image ID, but the same portable identity/site.
    Convert-Raw @($header, $main, $dll, $load, $store,
        "# image 30 $dllHash $(Name-Hex 'renamed.dll') 0x610000 0x630000 0",
        'L 0x2000 4 T2 C0x611234 I30', '# end 3 0 0')
    $lines = [IO.File]::ReadAllLines($output)
    Assert-True (@($lines -match '^# image ').Count -eq 2 -and $lines[-1] -eq 'L 0x2000 4 unknown:0 T2 K2') 'Reloaded image did not reuse its site.'

    Convert-Raw @($header, $main, "# image 40 - $(Name-Hex 'unknown.dll') 0x810000 0x820000 0",
        $load, 'S 0x1000 4 T7 C0x811234 I0', '# end 2 1 0')
    $lines = [IO.File]::ReadAllLines($output)
    Assert-True ($lines[-1] -eq 'S 0x1000 4 unknown:0 T7') 'Unattributed code was given an invented site.'
    Convert-Raw @('# hardware-explorer-pin-raw 1 32 10 2', $main, $dll, $load, $store, $end)
    Assert-True ([IO.File]::ReadAllLines($output)[1] -eq '# capture intel-pin i686-pc-windows-msvc 32 10 2 true') 'Sampling/truncation missing.'

    foreach ($case in @(
        @{ Lines = @($header, $main, $load); Error = 'incomplete' },
        @{ Lines = @($header, $main, $load, '# end 1 0 17'); Error = 'partial' },
        @{ Lines = @($header, $main, $load, '# end 2 0 0'); Error = 'counts' },
        @{ Lines = @($header, $main, $load, '# end 1 1 0'); Error = 'counts' },
        @{ Lines = @($header, ($main -replace 'a{64}', ('c' * 64)), $load, '# end 1 0 0'); Error = 'SHA256 mismatch' },
        @{ Lines = @($header, $main, $main); Error = 'duplicate' },
        @{ Lines = @($header, $main, ($main -replace 'image 10', 'image 11')); Error = 'duplicate main' },
        @{ Lines = @($header, $main, $store); Error = 'undeclared' },
        @{ Lines = @($header, $main, ($load -replace '401234', '421234')); Error = 'outside' },
        @{ Lines = @($header, ($main -replace '0x420000', '0x100000001')); Error = 'range' },
        @{ Lines = @($header, $main, ($load -replace '0x1000', '0xfffffffe')); Error = '32-bit' },
        @{ Lines = @($header, $main, ($load -replace '0x1000', '0x100000000')); Error = '32-bit' },
        @{ Lines = @($header, $main, ($load -replace 'T0', 'T-1')); Error = 'decimal' },
        @{ Lines = @($header, $main, ($load -replace ' 4 ', ' 0 ')); Error = '32-bit' },
        @{ Lines = @($header, $main, ($load -replace ' 4 ', ' 1048577 ')); Error = '32-bit' },
        @{ Lines = @($header, $main, "$load extra"); Error = 'malformed' },
        @{ Lines = @($header, $main, "$load$([char]0)"); Error = 'NUL' },
        @{ Lines = @($header, ('x' * 16385)); Error = '16 KiB' },
        @{ Lines = @($header, ($main -replace (Name-Hex 'game.exe'), (Name-Hex 'C:\secret\game.exe'))); Error = 'basename' },
        @{ Lines = @($header, ($main -replace (Name-Hex 'game.exe'), '0a')); Error = 'basename' },
        @{ Lines = @($header, ($main -replace (Name-Hex 'game.exe'), 'f')); Error = 'encoding' },
        @{ Lines = @($header, $main, $load, '# end 1 0 0', $load); Error = 'after capture' },
        @{ Lines = @('# hardware-explorer-pin-raw 1 32 0 100', $main); Error = 'sampling' },
        @{ Lines = @('# hardware-explorer-pin-raw 1 32 1 2000001', $main); Error = 'limit' },
        @{ Lines = @('# hardware-explorer-pin-raw 1 64 1 100', $main); Error = 'header' },
        @{ Lines = @('# hardware-explorer-pin-raw 1 32 1 1', $main, $load, $load); Error = 'limit' },
        @{ Lines = @($header, $main, $dll, ($dll -replace 'image 20', 'image 30' -replace '0x730000', '0x740000')); Error = 'inconsistent' },
        @{ Lines = @($header, $main, ($dll -replace 'b{64}', '-'), $store); Error = 'verified hash' }
    )) { Convert-Raw $case.Lines $case.Error }

    [IO.File]::WriteAllText($raw, ($valid -join "`n"), [Text.UTF8Encoding]::new($false))
    & $Normalizer $raw $output $hash
    Assert-True ($LASTEXITCODE -eq 0) 'Final line without newline was rejected.'
    $message = (& $Normalizer $raw $raw $hash 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -ne 0 -and $message -match 'different files') 'Allowed input overwrite.'
    $global:LASTEXITCODE = 0
    Write-Host 'Pin normalization: multi-image, ASLR, reload, unknown sites, bounds and failure-preservation tests passed.'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
