# Build against an explicitly installed Intel Pin 4.3.1 kit. The SDK is not bundled.
#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PinRoot,
    [string] $OutputDirectory = (Join-Path $PSScriptRoot 'obj-ia32'),
    [string] $Compiler = 'clang-cl',
    [string] $Linker = 'lld-link'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Building this Pintool requires Windows.' }
$kit = (Resolve-Path -LiteralPath $PinRoot).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null
$object = Join-Path $output 'windows_capture.obj'
$dll = Join-Path $output 'hardware_explorer_pin.dll'
$compilerPath = (Get-Command $Compiler -ErrorAction Stop).Source
$linkerPath = (Get-Command $Linker -ErrorAction Stop).Source
$version = (& $compilerPath --version | Select-Object -First 1)
if ($version -notmatch 'clang version (15|16)\.') {
    throw "Pin 4.3.1 requires clang-cl 15 or 16. Found: $version"
}

# Intel's documented no-wrapper build flags: never link the tool to the target CRT.
$compileArguments = @(
    '-m32', '/std:c++17', '/O2', '/MD', '/DNDEBUG', '-nostdinc', '-fno-builtin',
    '/GS-', '/EHa-', '/EHs-', '/EHc-', '/Oi-', '/Gy', '/GR-', '/Zc:threadSafeInit-',
    '/wd4530', '/wd5208', '/fp:strict', '-Wno-non-c-typedef-for-linkage',
    '-Wno-microsoft-include', '-Wno-unicode',
    '/DPIN_CRT=1', '/DPIN_RT=1', '/DTARGET_WINDOWS', '/DTARGET_IA32', '/DHOST_IA32',
    '/D_arch_long=long', '/D__i386__', '/D_GNU_SOURCE', '/D_XOPEN_SOURCE=700',
    '/D_POSIX_C_SOURCE=200809L', '/D_LIBCPP_HAS_MUSL_LIBC', '/D_LIBCPP_NO_VCRUNTIME',
    '/D_LIBCPP_DISABLE_AVAILABILITY'
)
foreach ($include in @('source/include/pin', 'source/include/pin/gen', 'extras/components/include',
    'extras/xed-ia32/include/xed', 'ia32/pinrt/include/adaptor')) {
    $compileArguments += "/I$(Join-Path $kit $include)"
}
foreach ($include in @('ia32/pinrt/include/c++', 'ia32/pinrt/include', 'ia32/pinrt/include/pinos')) {
    $compileArguments += @('-Xclang', '-internal-isystem', '-Xclang', (Join-Path $kit $include))
}
$compileArguments += @('/c', "/Fo$object", (Join-Path $PSScriptRoot 'windows_capture.cpp'))
& $compilerPath @compileArguments
if ($LASTEXITCODE -ne 0) { throw "Pin tool compilation failed: $LASTEXITCODE" }

$linkArguments = @('/DLL', '/EXPORT:main', '/NODEFAULTLIB', '/SAFESEH:NO', '/SUBSYSTEM:CONSOLE',
    '/INCREMENTAL:NO', '/IGNORE:4210', '/IGNORE:4049', '/DYNAMICBASE', '/NXCOMPAT', '/OPT:REF',
    '/MACHINE:X86', "/OUT:$dll", $object,
    (Join-Path $kit 'ia32/pinrt/lib/crtbeginS.obj'),
    (Join-Path $kit 'ia32/pinrt/lib/stdlib_new_delete.obj'),
    'pin.lib', 'pinrt-adaptor-static.lib', 'xed.lib', 'c++.lib', 'pincrt4.lib', 'kernel32.lib')
foreach ($library in @('ia32/lib', 'ia32/pinrt/lib', 'extras/xed-ia32/lib')) {
    $linkArguments += "/LIBPATH:$(Join-Path $kit $library)"
}
& $linkerPath @linkArguments
if ($LASTEXITCODE -ne 0) { throw "Pin tool linking failed: $LASTEXITCODE" }
Write-Host "Built Windows IA-32 capture tool: $dll"
