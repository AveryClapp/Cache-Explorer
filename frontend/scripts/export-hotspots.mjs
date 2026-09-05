// Node 22.18+; npm ci in frontend first. No target files are opened or executed.
import { readFile, stat, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { importBinaryProfile, MAX_FILE_BYTES } from '../src/binary/hotspots.ts'

const [input, output, ...extra] = process.argv.slice(2)
if (!input || !output || extra.length || resolve(input) === resolve(output)) {
  throw new Error('Usage: node frontend/scripts/export-hotspots.mjs analysis.json hardware-explorer-hotspots-v1.json (distinct files)')
}
if ((await stat(input)).size > MAX_FILE_BYTES) throw new Error('Input exceeds 16 MiB.')
const bundle = importBinaryProfile(await readFile(input, 'utf8'))
const temporary = join(dirname(resolve(output)), `.hardware-explorer-${randomUUID()}.tmp`)
try {
  await writeFile(temporary, JSON.stringify(bundle, null, 2), { flag: 'wx', mode: 0o600 })
  await rename(temporary, output)
} finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
console.log(`Exported ${bundle.codeHotspots.length} ranked sites. No data addresses, source paths or load addresses included.`)
