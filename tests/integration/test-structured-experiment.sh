#!/bin/bash
# Integration test: structured /experiment variants with per-variant source code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT="${CACHE_EXPLORER_TEST_PORT:-3015}"
SERVER_LOG="$(mktemp /tmp/cache-explorer-structured-experiment.XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

echo "========================================"
echo "  Structured Experiment Tests"
echo "========================================"
echo ""

echo -n "Test: backend accepts per-variant source experiments... "
(
  cd "$PROJECT_ROOT/backend/server"
  PORT="$PORT" node server.js > "$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

for _ in {1..80}; do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

OUTPUT=$(cd "$PROJECT_ROOT" && TEST_PORT="$PORT" node --input-type=module <<'NODE'
import { readFileSync } from 'fs'

async function postExperiment(body) {
  const response = await fetch(`http://127.0.0.1:${process.env.TEST_PORT}/experiment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    console.error(JSON.stringify(data, null, 2))
    process.exit(1)
  }
  return data
}

const row = readFileSync('examples/matrix_row.c', 'utf8')
const column = readFileSync('examples/matrix_col.c', 'utf8')
const data = await postExperiment({
  language: 'c',
  optLevel: '-O0',
  configs: ['educational'],
  limit: 200000,
  variants: [
    { id: 'row', code: row, language: 'c', optLevel: '-O0' },
    { id: 'column', code: column, language: 'c', optLevel: '-O0' },
  ],
})

const rowSummary = data.summary?.find(item => item.variant === 'row')
const columnSummary = data.summary?.find(item => item.variant === 'column')
const sourceOk = data.baselineVariant === 'row'
  && data.variants?.row?.configs?.educational
  && data.variants?.column?.configs?.educational
  && rowSummary?.estimatedCycles > 0
  && columnSummary?.estimatedCycles > 0
  && typeof columnSummary?.cycleDelta === 'number'
  && data.provenance?.resultKind === 'hardware-experiment'

if (!sourceOk) {
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

const prefetchSource = readFileSync('examples/prefetch_friendly.c', 'utf8')
const prefetchData = await postExperiment({
  language: 'c',
  optLevel: '-O2',
  configs: ['intel'],
  limit: 100000,
  variants: [
    { id: 'none', code: prefetchSource, language: 'c', optLevel: '-O2', prefetch: 'none' },
    { id: 'stream', code: prefetchSource, language: 'c', optLevel: '-O2', prefetch: 'stream' },
  ],
})

const noneSummary = prefetchData.summary?.find(item => item.variant === 'none')
const streamSummary = prefetchData.summary?.find(item => item.variant === 'stream')
const prefetchOk = prefetchData.variants?.none?.configs?.intel?.provenance?.fidelity?.prefetch === 'none'
  && prefetchData.variants?.stream?.configs?.intel?.provenance?.fidelity?.prefetch === 'stream'
  && noneSummary?.estimatedCycles > 0
  && streamSummary?.estimatedCycles > 0
  && streamSummary.estimatedCycles < noneSummary.estimatedCycles

if (!prefetchOk) {
  console.error(JSON.stringify(prefetchData, null, 2))
  process.exit(1)
}

const conv2d = readFileSync('examples/conv2d_kernel.c', 'utf8')
const defaultData = await postExperiment({
  code: conv2d,
  language: 'c',
  optLevel: '-O2',
  configs: ['educational', 'intel', 'amd', 'apple'],
  prefetch: 'adaptive',
  limit: 200000,
  fast: true,
  cacheSegments: true,
  variants: ['direct', 'tiled:RUN_TILED=1'],
})

const defaultConfigs = ['educational', 'intel', 'amd', 'apple']
const tiledSummary = defaultData.summary?.find(item => item.variant === 'tiled')
const defaultOk = defaultData.baselineVariant === 'direct'
  && defaultData.summary?.length === 8
  && tiledSummary?.variantSpec === 'tiled:RUN_TILED=1'
  && defaultData.provenance?.source?.variants?.includes('tiled:RUN_TILED=1')
  && defaultConfigs.every(config => defaultData.variants?.direct?.configs?.[config])
  && defaultConfigs.every(config => defaultData.variants?.tiled?.configs?.[config])
  && defaultConfigs.some(config => {
    const direct = defaultData.summary.find(item => item.variant === 'direct' && item.config === config)
    const tiled = defaultData.summary.find(item => item.variant === 'tiled' && item.config === config)
    return direct?.estimatedCycles !== tiled?.estimatedCycles
  })

if (!defaultOk) {
  console.error(JSON.stringify(defaultData, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({
  sourceVariants: {
    baseline: data.baselineVariant,
    rows: data.summary.length,
    rowCycles: rowSummary.estimatedCycles,
    columnCycles: columnSummary.estimatedCycles,
    columnDelta: columnSummary.cycleDelta,
  },
  prefetchVariants: {
    baseline: prefetchData.baselineVariant,
    noneCycles: noneSummary.estimatedCycles,
    streamCycles: streamSummary.estimatedCycles,
  },
  defaultJourney: {
    configs: defaultConfigs,
    variants: Object.keys(defaultData.variants),
    rows: defaultData.summary.length,
    eventLimit: 200000,
  },
}))
NODE
)

echo "PASS"
echo "$OUTPUT"
echo ""
echo "All structured experiment tests passed!"
