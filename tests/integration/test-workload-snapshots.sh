#!/bin/bash
# Integration test: executable workload snapshot relationships.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_EXPLORE="$PROJECT_ROOT/backend/scripts/cache-explore"
SNAPSHOT_DIR="$PROJECT_ROOT/benchmarks/workloads"

PASSED=0
FAILED=0

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() {
  echo "PASS"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "FAIL"
  echo "    $1"
  FAILED=$((FAILED + 1))
}

metric_value() {
  local result_file="$1"
  local metric="$2"
  jq -r --arg metric "$metric" 'getpath($metric | split("."))' "$result_file"
}

float_less_than() {
  awk "BEGIN { exit !($1 < $2) }"
}

run_variant() {
  local snapshot="$1"
  local variant_index="$2"
  local output_file="$3"

  local example opt_level config limit
  example="$(jq -r '.example' "$snapshot")"
  opt_level="$(jq -r '.optLevel // empty' "$snapshot")"
  config="$(jq -r '.config' "$snapshot")"
  limit="$(jq -r '.limit // empty' "$snapshot")"

  local args=("$PROJECT_ROOT/$example")
  if [[ -n "$opt_level" ]]; then
    args+=("$opt_level")
  fi

  while IFS= read -r define; do
    args+=("-D" "$define")
  done < <(jq -r ".variants[$variant_index].defines[]?" "$snapshot")

  args+=("--config" "$config")
  if [[ -n "$limit" ]]; then
    args+=("--limit" "$limit")
  fi

  "$CACHE_EXPLORE" "${args[@]}" --json 2>/dev/null |
    jq -s 'map(select(.levels? and .timing?))[-1]' > "$output_file"
}

variant_result_file() {
  local snapshot_id="$1"
  local variant_id="$2"
  printf '%s/%s-%s.json' "$TMP_DIR" "$snapshot_id" "$variant_id"
}

echo "========================================"
echo "  Workload Snapshot Tests"
echo "========================================"
echo ""

shopt -s nullglob
snapshots=("$SNAPSHOT_DIR"/*.json)
if [[ "${#snapshots[@]}" -eq 0 ]]; then
  echo "No workload snapshots found in $SNAPSHOT_DIR"
  exit 1
fi

for snapshot in "${snapshots[@]}"; do
  snapshot_id="$(jq -r '.id' "$snapshot")"
  description="$(jq -r '.description' "$snapshot")"
  echo "Snapshot: $snapshot_id"
  echo "  $description"

  variant_count="$(jq '.variants | length' "$snapshot")"
  for ((i = 0; i < variant_count; i++)); do
    variant_id="$(jq -r ".variants[$i].id" "$snapshot")"
    run_variant "$snapshot" "$i" "$(variant_result_file "$snapshot_id" "$variant_id")"
  done

  relationship_count="$(jq '.expectedRelationships | length' "$snapshot")"
  for ((i = 0; i < relationship_count; i++)); do
    metric="$(jq -r ".expectedRelationships[$i].metric" "$snapshot")"
    relationship="$(jq -r ".expectedRelationships[$i].relationship" "$snapshot")"
    left_variant="$(awk '{print $1}' <<< "$relationship")"
    operator="$(awk '{print $2}' <<< "$relationship")"
    right_variant="$(awk '{print $3}' <<< "$relationship")"

    left_value="$(metric_value "$(variant_result_file "$snapshot_id" "$left_variant")" "$metric")"
    right_value="$(metric_value "$(variant_result_file "$snapshot_id" "$right_variant")" "$metric")"

    echo -n "Test: $snapshot_id $metric $relationship... "
    case "$operator" in
      '>')
        if float_less_than "$right_value" "$left_value"; then
          pass
        else
          fail "expected $left_variant ($left_value) > $right_variant ($right_value)"
        fi
        ;;
      '<')
        if float_less_than "$left_value" "$right_value"; then
          pass
        else
          fail "expected $left_variant ($left_value) < $right_variant ($right_value)"
        fi
        ;;
      *)
        fail "unsupported relationship operator: $operator"
        ;;
    esac
  done
  echo ""
done

echo "========================================"
echo "  Workload Snapshot Summary"
echo "========================================"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi

echo ""
echo "All workload snapshot tests passed!"
