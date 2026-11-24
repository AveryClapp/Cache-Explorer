#!/usr/bin/env node
// Unit checks for src/utils/sourcePath.ts (editor decoration matching and
// cross-run hot-line keys).
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/sourcePath.ts', import.meta.url), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const tempFile = join(tmpdir(), `cache-explorer-source-paths-${process.pid}.mjs`)
await writeFile(tempFile, transpiled)

try {
  const { matchesEditorFile, sourceLineKey, displaySourcePath } = await import(pathToFileURL(tempFile).href)

  const mac = '/var/folders/xy/T/cache-explorer-1b2c3d4e/main.c'
  const linux = '/tmp/cache-explorer-1b2c3d4e/main.c'
  const sandbox = '/tmp/cache-explorer-9f9f/input.cpp'

  // Single editor buffer: the backend renames it to main.* / input.*.
  assert.equal(matchesEditorFile(mac, 'main.c', 1), true)
  assert.equal(matchesEditorFile(linux, 'matrix.c', 1), true)
  assert.equal(matchesEditorFile(sandbox, 'kernel.cpp', 1), true)
  assert.equal(matchesEditorFile('main.c', 'main.c', 1), true)
  // System headers never decorate the editor.
  assert.equal(matchesEditorFile('/usr/include/stdlib.h', 'main.c', 1), false)
  assert.equal(matchesEditorFile('', 'main.c', 1), false)

  // Multi-file: match by sanitized tab name only.
  const util = '/var/folders/xy/T/cache-explorer-1b2c/util.c'
  assert.equal(matchesEditorFile(util, 'util.c', 2), true)
  assert.equal(matchesEditorFile(util, 'main.c', 2), false)
  assert.equal(matchesEditorFile(mac, 'util.c', 2), false)
  assert.equal(matchesEditorFile('/tmp/cache-explorer-1/my_file.c', 'my file.c', 2), true)

  // Keys are stable across runs with different temp directories.
  assert.equal(sourceLineKey(mac, 15), sourceLineKey(linux, 15))
  assert.notEqual(sourceLineKey(mac, 15), sourceLineKey(mac, 16))

  assert.equal(displaySourcePath(mac), 'main.c')
  assert.equal(displaySourcePath('/usr/include/stdio.h'), '/usr/include/stdio.h')

  console.log('Source path checks passed')
} finally {
  await rm(tempFile, { force: true })
}
