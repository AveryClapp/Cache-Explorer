#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const rootDir = new URL('..', import.meta.url).pathname
const srcDir = join(rootDir, 'src')
const scannedExtensions = new Set(['.css', '.ts', '.tsx'])
const definitionExtensions = new Set(['.css'])
const defined = new Map()
const used = new Map()

function extensionOf(file) {
  const match = file.match(/\.[^.]+$/)
  return match ? match[0] : ''
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else if (scannedExtensions.has(extensionOf(path))) files.push(path)
  }
  return files
}

function addOccurrence(map, token, file, index) {
  if (!map.has(token)) map.set(token, [])
  map.get(token).push({ file, index })
}

for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(rootDir, file)

  if (definitionExtensions.has(extensionOf(file))) {
    for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
      addOccurrence(defined, match[1], rel, match.index || 0)
    }
  }

  for (const match of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    addOccurrence(used, match[1], rel, match.index || 0)
  }
}

const missing = [...used.keys()].filter(token => !defined.has(token)).sort()

if (missing.length === 0) {
  console.log(`CSS token check passed (${used.size} used, ${defined.size} defined).`)
  process.exit(0)
}

console.error('Missing CSS custom properties:')
for (const token of missing) {
  const locations = used.get(token)
    .slice(0, 5)
    .map(({ file }) => file)
    .join(', ')
  console.error(`- ${token} (${locations})`)
}
process.exit(1)
