#!/bin/bash
# Integration test: verify backend health probes work in ESM mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================"
echo "  Server Health Tests"
echo "========================================"
echo ""

echo -n "Test: temp directory health probe... "
OUTPUT=$(cd "$PROJECT_ROOT/backend/server" && node --input-type=module - <<'NODE'
import { getHealthStatus } from './metrics.js';

const health = getHealthStatus();
if (health.checks.temp_dir !== 'ok') {
  console.error(JSON.stringify(health, null, 2));
  process.exit(1);
}

console.log(health.checks.temp_dir);
NODE
)

if [[ "$(printf '%s\n' "$OUTPUT" | tail -n 1)" == "ok" ]]; then
  echo "PASS"
else
  echo "FAIL"
  echo "$OUTPUT"
  exit 1
fi

echo ""
echo "All server health tests passed!"
