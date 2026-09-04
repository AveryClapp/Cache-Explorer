# Shared, bounded PE32 validation for local x86 capture scripts.
function Get-HardwareExplorerPeImage {
    param([Parameter(Mandatory = $true)] [string] $Path)

    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) {
            throw "'$Path' does not contain a DOS/PE header."
        }
        $stream.Position = 0x3c
        [Int64] $peOffset = $reader.ReadUInt32()
        if ($peOffset -lt 64 -or $peOffset -gt $stream.Length - 24) {
            throw "'$Path' has an out-of-bounds PE header."
        }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x014c) {
            throw "'$Path' must be an x86 PE32 image (i386)."
        }
        $stream.Position = $peOffset + 20
        $optionalSize = $reader.ReadUInt16()
        $characteristics = $reader.ReadUInt16()
        if ($optionalSize -lt 96 -or $peOffset + 24 + $optionalSize -gt $stream.Length -or
            $reader.ReadUInt16() -ne 0x10b) {
            throw "'$Path' has an invalid PE32 optional header."
        }
        if (($characteristics -band 0x2000) -ne 0 -or ($characteristics -band 0x2) -eq 0) {
            throw "'$Path' must be an executable, not a DLL. Multi-image capture is not available yet."
        }
        $stream.Position = $peOffset + 24 + 56
        [UInt64] $sizeOfImage = $reader.ReadUInt32()
        if ($sizeOfImage -eq 0) {
            throw "'$Path' reports a zero SizeOfImage."
        }
        return [PSCustomObject]@{ SizeOfImage = $sizeOfImage }
    } finally {
        $reader.Dispose()
    }
}
