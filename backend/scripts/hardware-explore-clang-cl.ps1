# Hardware Explorer clang-cl wrapper for Windows source instrumentation.
#
# This wrapper enables clang-cl's built-in load/store instrumentation and adds
# the Hardware Explorer runtime to an existing command. It preserves the normal
# clang-cl argument surface so it can be used anywhere a build invokes the
# compiler directly. CMake users should prefer the integration module.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CompilerArguments
)

$ErrorActionPreference = 'Stop'

function Find-FirstExistingFile {
    param([string[]] $Candidates)

    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$backendDirectory = Split-Path -Parent $PSScriptRoot

$runtimePath = Find-FirstExistingFile @(
    $env:HARDWARE_EXPLORER_RUNTIME,
    $env:CACHE_EXPLORER_RUNTIME,
    (Join-Path $backendDirectory 'runtime\build\cache-explorer-rt.lib'),
    (Join-Path $backendDirectory 'runtime\build\Release\cache-explorer-rt.lib')
)

if (-not $runtimePath) {
    throw 'cache-explorer-rt.lib was not found. Build backend/runtime for the target architecture or set HARDWARE_EXPLORER_RUNTIME.'
}

$compiler = if ($env:HARDWARE_EXPLORER_CLANG_CL) {
    $env:HARDWARE_EXPLORER_CLANG_CL
} elseif ($env:CACHE_EXPLORER_CLANG_CL) {
    $env:CACHE_EXPLORER_CLANG_CL
} else {
    (Get-Command clang-cl -ErrorAction Stop).Source
}

$compileOnly = $CompilerArguments -contains '/c' -or $CompilerArguments -contains '-c'
$arguments = @(
    '/clang:-fsanitize-coverage=trace-pc,trace-loads,trace-stores,no-prune',
    '/Z7',
    "/I$($backendDirectory)\runtime"
) + $CompilerArguments

if (-not $compileOnly) {
    $arguments += $runtimePath
}

& $compiler @arguments
exit $LASTEXITCODE
