#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const frontendDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const assetsDir = join(frontendDir, 'dist', 'assets')

const budgets = [
  {
    label: 'main app',
    pattern: /^index-[\w-]+\.js$/,
    maxBytes: 360 * 1024,
    maxGzipBytes: 105 * 1024,
    required: true,
  },
  {
    label: 'app css',
    pattern: /^index-[\w-]+\.css$/,
    maxBytes: 120 * 1024,
    maxGzipBytes: 20 * 1024,
    required: true,
  },
  {
    label: 'monaco editor',
    pattern: /^monaco-[\w-]+\.js$/,
    // Monaco is bundled for offline use instead of being fetched from a CDN.
    maxBytes: 3800 * 1024,
    maxGzipBytes: 1000 * 1024,
    required: true,
  },
  {
    label: 'monaco css',
    pattern: /^monaco-[\w-]+\.css$/,
    maxBytes: 180 * 1024,
    maxGzipBytes: 30 * 1024,
    required: true,
  },
  {
    label: 'lazy product modal',
    pattern: /^(BatchResultsModal|CommandPalette|ExperimentResultsModal|HardwareExplorerModal|WorkloadCatalogModal)-[\w-]+\.js$/,
    maxBytes: 32 * 1024,
    maxGzipBytes: 10 * 1024,
    required: false,
    multiple: true,
  },
]

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

function assetRecord(file) {
  const path = join(assetsDir, file)
  const contents = readFileSync(path)
  return {
    file,
    bytes: statSync(path).size,
    gzipBytes: gzipSync(contents).length,
  }
}

function overBudget(record, budget) {
  return record.bytes > budget.maxBytes || record.gzipBytes > budget.maxGzipBytes
}

function printRecord(record, budget) {
  const status = overBudget(record, budget) ? 'FAIL' : 'ok'
  console.log(
    `${status.padEnd(4)} ${budget.label.padEnd(18)} ${record.file.padEnd(48)} ` +
    `${formatKiB(record.bytes).padStart(10)} / ${formatKiB(record.gzipBytes).padStart(10)} gzip ` +
    `(budget ${formatKiB(budget.maxBytes)} / ${formatKiB(budget.maxGzipBytes)} gzip)`,
  )
}

if (!existsSync(assetsDir)) {
  console.error(`Missing build assets at ${assetsDir}. Run npm run build first.`)
  process.exit(1)
}

const assets = readdirSync(assetsDir).sort()
let failed = false

console.log('Bundle budget report')
for (const budget of budgets) {
  const matches = assets.filter(file => budget.pattern.test(file)).map(assetRecord)

  if (budget.required && matches.length === 0) {
    console.error(`FAIL ${budget.label}: no matching asset found`)
    failed = true
    continue
  }

  const records = budget.multiple ? matches : matches.slice(0, 1)
  for (const record of records) {
    printRecord(record, budget)
    if (overBudget(record, budget)) failed = true
  }
}

if (failed) {
  console.error('Bundle budget check failed.')
  process.exit(1)
}

console.log('Bundle budget check passed.')
