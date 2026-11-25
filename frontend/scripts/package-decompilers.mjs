// Build a self-contained, local adapter distribution. Never install into a user's apps.
import { cp, mkdir, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('../../', import.meta.url))
const output = process.argv[2]
if (!output) throw new Error('Usage: node frontend/scripts/package-decompilers.mjs NEW_OUTPUT_DIRECTORY')
const destination = resolve(output)
await mkdir(destination) // Refuse existing destinations rather than overwrite installs.
const ghidra = join(destination, 'ghidra')
const ida = join(destination, 'ida')
await mkdir(ghidra); await mkdir(ida)
await mkdir(join(ida, 'hardware_explorer_support'))
for (const name of ['HardwareExplorer.java', 'HardwareExplorerBundle.java']) await copyFile(join(repo, 'integrations/ghidra', name), join(ghidra, name))
await copyFile(join(repo, 'integrations/ida/hardware_explorer.py'), join(ida, 'hardware_explorer.py'))
await copyFile(join(repo, 'integrations/ida/hardware_explorer_bundle.py'), join(ida, 'hardware_explorer_support/hardware_explorer_bundle.py'))
await copyFile(join(repo, 'integrations/ida/requirements.txt'), join(ida, 'requirements.txt'))
for (const folder of [ghidra, join(ida, 'hardware_explorer_support')]) await copyFile(join(repo, 'frontend/src/binary/hotspots.schema.json'), join(folder, 'hotspots.schema.json'))
await cp(join(repo, 'integrations/README.md'), join(destination, 'README.md'))
console.log(`Packaged adapters in ${destination}. Ghidra 12.1.3 Preview; IDA experimental/unverified.`)
