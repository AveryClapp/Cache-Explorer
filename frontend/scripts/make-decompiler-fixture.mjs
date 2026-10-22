import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { importBinaryProfile } from '../src/binary/hotspots.ts'
const [exe, output] = process.argv.slice(2)
if (!exe || !output) throw new Error('Usage: make-decompiler-fixture.mjs fixture.exe output.json')
const bytes = await readFile(exe)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const pe = bytes.readUInt32LE(0x3c)
const base = bytes.readUInt32LE(pe + 24 + 28)
const size = bytes.readUInt32LE(pe + 24 + 56)
// This deliberately synthetic modeled profile exercises decompiler navigation;
// it is not a captured benchmark and must not be presented as calibration.
const analysis = {
  capture: { traceFormat: 2, kind: 'intel-pin', target: 'i686-pc-windows-msvc', addressWidth: 32, sampleRate: 1, eventLimit: 1000, truncated: false },
  profile: { id: 'test-fixture', displayName: 'Synthetic test fixture', modelConfidence: 'synthetic-test-only' },
  images: [{ id: `sha256:${sha256}`, sha256, name: 'fixture.exe', loadedBase: `0x${base.toString(16)}`, endAddress: `0x${(base + size).toString(16)}` }],
  codeHotspots: ['0x1015', '0x1021'].map(rva => ({ location: { imageId: `sha256:${sha256}`, rva }, navigationConfidence: 'unresolved', metrics: { accesses: 10, reads: 8, writes: 2, l1dHits: 6, l1dMisses: 4, l1dMissRate: .4, estimatedMemoryStallCycles: 100 } })),
}
await writeFile(output, JSON.stringify(importBinaryProfile(JSON.stringify(analysis)), null, 2))
