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

const TOKENS_FILE = join('src', 'styles', 'tokens.css')
// Type and spacing scale steps may go unused; every other token must earn its place.
const isScaleStep = token => /^--(space-\d+|text-(\d?xs|sm|base|md|lg|\d?xl))$/.test(token)
const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g
const blankComments = text => text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
const problems = []

for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(rootDir, file)

  if (definitionExtensions.has(extensionOf(file))) {
    for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
      addOccurrence(defined, match[1], rel, match.index || 0)
      if (rel !== TOKENS_FILE) problems.push(`${rel}: defines ${match[1]}; tokens live in ${TOKENS_FILE}`)
    }
    if (rel !== TOKENS_FILE) {
      const css = blankComments(text)
      for (const match of css.matchAll(colorLiteral)) {
        const line = css.slice(0, match.index).split('\n').length
        problems.push(`${rel}:${line}: raw color "${match[0]}"; use a token from ${TOKENS_FILE}`)
      }
    }
  }

  for (const match of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    addOccurrence(used, match[1], rel, match.index || 0)
  }
}

for (const token of [...used.keys()].filter(token => !defined.has(token)).sort()) {
  const locations = used.get(token).slice(0, 5).map(({ file }) => file).join(', ')
  problems.push(`missing ${token} (used in ${locations})`)
}
for (const token of [...defined.keys()].filter(token => !used.has(token) && !isScaleStep(token)).sort()) {
  problems.push(`unused ${token}; remove it from ${TOKENS_FILE}`)
}

if (problems.length === 0) {
  console.log(`CSS token check passed (${used.size} used, ${defined.size} defined, no raw colors outside ${TOKENS_FILE}).`)
  process.exit(0)
}

console.error('CSS token check failed:')
for (const problem of problems) console.error(`- ${problem}`)
process.exit(1)
