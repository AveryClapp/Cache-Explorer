import assert from 'node:assert/strict'
import { importBinaryProfile, validateBundle, groupHotspots } from '../src/binary/hotspots.ts'

export function fixtureAnalysis() {
  const hash = 'a'.repeat(64), other = 'b'.repeat(64)
  const metrics = { accesses: 10, reads: 7, writes: 3, l1dHits: 6, l1dMisses: 4, l1dMissRate: .4, estimatedMemoryStallCycles: 128 }
  return {
    capture: { kind: 'intel-pin', traceFormat: 2, target: 'i686-pc-windows-msvc', addressWidth: 32, sampleRate: 7, eventLimit: 1000, truncated: true },
    profile: { id: 'intel', displayName: 'Intel Preview', modelConfidence: 'estimated', details: { cache: { levels: { l1d: { sizeKB: 32, associativity: 8, lineSize: 64 } } } } },
    images: [hash, other].map((sha256, i) => ({ id: `sha256:${sha256}`, name: i ? 'C:\\private\\game plugin.dll' : '/private/game.exe', sha256, loadedBase: '0x400000', endAddress: '0x410000' })),
    codeHotspots: [hash, hash, other].map((sha256, i) => ({ location: { imageId: `sha256:${sha256}`, rva: i === 1 ? '0x1200' : '0x1100' }, navigationConfidence: i === 0 ? 'function-exact' : 'unresolved', ...(i === 0 ? { symbol: { function: 'update_world', functionRva: '0x1000' } } : {}), metrics, source: { file: '/private/source.c', line: 12 } })),
    hotLines: [{ file: '/private/source.c', address: '0x12345678' }], timeline: [{ address: '0x87654321' }], warnings: ['/private/do-not-export'],
  }
}
const original = fixtureAnalysis()
const bundle = importBinaryProfile(JSON.stringify(original))
const text = JSON.stringify(bundle)
for (const privateField of ['/private', 'loadedBase', 'endAddress', 'source.c', '12345678', '87654321', 'do-not-export']) assert(!text.includes(privateField), privateField)
assert.equal(bundle.images[1].name, 'game plugin.dll')
assert.deepEqual(importBinaryProfile(text), bundle)
assert.equal(bundle.profile.configuration['cache.levels.l1d.sizeKB'], 32)
assert.equal(groupHotspots(bundle, bundle.images[0].id, '', 'l1dMisses').length, 2)
assert.equal(groupHotspots(bundle, bundle.images[0].id, 'update', 'accesses')[0].sites.length, 1)
assert.equal(groupHotspots(bundle, bundle.images[1].id, '', 'accesses')[0].name, 'Unresolved function')
const reject = (mutate) => { const copy = structuredClone(bundle); mutate(copy); assert.throws(() => validateBundle(copy)) }
reject(b => b.schemaVersion = 2)
reject(b => b.capture.addressWidth = 64)
reject(b => b.images[0].sha256 = 'c'.repeat(64))
reject(b => b.images.push(b.images[0]))
reject(b => b.codeHotspots[0].location.imageId = `sha256:${'c'.repeat(64)}`)
reject(b => b.codeHotspots[0].location.rva = '0x10000')
reject(b => b.codeHotspots[0].lookup.rva = '0x10ff')
reject(b => b.codeHotspots[0].metrics.accesses = 1)
reject(b => b.codeHotspots[0].metrics.l1dMissRate = .9)
reject(b => b.codeHotspots[0].metrics.accesses = Number.MAX_VALUE)
reject(b => b.codeHotspots[0].symbol.functionRva = '0x1200')
reject(b => b.codeHotspots[0].navigationConfidence = 'instruction-exact')
reject(b => b.codeHotspots[1].symbol = { function: 'invented', functionRva: '0x1000' })
reject(b => b.images[0].loadedBase = '0x400000')
reject(b => b.images[0].name = 'C:\\secret\\game.exe')
reject(b => b.profile.configuration.path = '/private/path')
reject(b => b.codeHotspots[1] = b.codeHotspots[0])
assert.throws(() => importBinaryProfile('{"capture":null}'))
assert.throws(() => importBinaryProfile('x'.repeat(16 * 1024 * 1024 + 1)))
const clang = structuredClone(original); clang.capture.kind = 'clang-cl'
assert.equal(importBinaryProfile(JSON.stringify(clang)).codeHotspots[0].lookup.rva, '0x10ff')
console.log('Binary bundle schema, privacy, identity, metrics, grouping and capture-specific lookup tests passed.')
