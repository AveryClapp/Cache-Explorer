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

const row = readFileSync('examples/matrix_row.c', 'utf8')
const column = readFileSync('examples/matrix_col.c', 'utf8')
const response = await fetch(`http://127.0.0.1:${process.env.TEST_PORT}/experiment`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    language: 'c',
    optLevel: '-O0',
    configs: ['educational'],
    limit: 200000,
    variants: [
      { id: 'row', code: row, language: 'c', optLevel: '-O0' },
      { id: 'column', code: column, language: 'c', optLevel: '-O0' },
    ],
  }),
})

const data = await response.json()
if (!response.ok) {
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

const rowSummary = data.summary?.find(item => item.variant === 'row')
const columnSummary = data.summary?.find(item => item.variant === 'column')
const ok = data.baselineVariant === 'row'
  && data.variants?.row?.configs?.educational
  && data.variants?.column?.configs?.educational
  && rowSummary?.estimatedCycles > 0
  && columnSummary?.estimatedCycles > 0
  && typeof columnSummary?.cycleDelta === 'number'
  && data.provenance?.resultKind === 'hardware-experiment'

if (!ok) {
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({
  baseline: data.baselineVariant,
  rows: data.summary.length,
  rowCycles: rowSummary.estimatedCycles,
  columnCycles: columnSummary.estimatedCycles,
  columnDelta: columnSummary.cycleDelta,
}))
NODE
)

echo "PASS"
echo "$OUTPUT"
echo ""
echo "All structured experiment tests passed!"
