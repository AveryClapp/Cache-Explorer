import type { CacheResult } from '../types'

interface DiffSummaryProps {
  result: CacheResult
  baselineResult: CacheResult
  baselineConfig?: string | null
}

// The same "estimated cycles" number the bottleneck card shows, so the two
// panels never disagree.
function estimatedCycles(result: CacheResult): number | null {
  return result.summary?.estimatedCycles
    ?? (result.subsystems?.execution ?? result.execution)?.pipeline?.cycles
    ?? null
}

function l1Misses(result: CacheResult) {
  return (result.levels.l1d || result.levels.l1)?.misses ?? 0
}

function memoryMisses(result: CacheResult) {
  const l3 = result.levels.l3
  return (result.cacheConfig?.l3?.sizeKB ?? 0) > 0 && l3 ? l3.misses : result.levels.l2.misses
}

function Row({ label, current, baseline }: { label: string; current: number | null; baseline: number | null }) {
  if (current == null || baseline == null) return null
  const diff = current - baseline
  const pct = baseline !== 0 ? (diff / baseline) * 100 : 0
  const tone = diff === 0 ? 'same' : diff < 0 ? 'better' : 'worse'
  return (
    <div className="diff-detail">
      <span>{label}</span>
      <span>
        {baseline.toLocaleString()} → {current.toLocaleString()}
        <span className={`diff-change ${tone}`}>
          {diff === 0 ? 'no change' : `${diff > 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </span>
      </span>
    </div>
  )
}

export function DiffSummary({ result, baselineResult, baselineConfig }: DiffSummaryProps) {
  const configMismatch = baselineConfig && result.config && result.config !== baselineConfig
  const cyclesCur = estimatedCycles(result)
  const cyclesBase = estimatedCycles(baselineResult)
  const cyclesDiff = cyclesCur != null && cyclesBase ? (cyclesCur - cyclesBase) / cyclesBase * 100 : 0
  const missDiff = l1Misses(baselineResult) > 0
    ? (l1Misses(result) - l1Misses(baselineResult)) / l1Misses(baselineResult) * 100
    : 0
  const improved = cyclesDiff < -2 || (Math.abs(cyclesDiff) <= 2 && missDiff < -5)
  const degraded = cyclesDiff > 2 || (Math.abs(cyclesDiff) <= 2 && missDiff > 5)

  return (
    <div className="diff-summary panel">
      <div className="panel-header">
        <span className="panel-title">Compared with baseline</span>
      </div>
      {configMismatch && (
        <div className="diff-config-warning">
          <span>CPU profile changed ({baselineConfig} → {result.config}), so differences include the hardware change.</span>
        </div>
      )}
      <div className="diff-summary-content">
        <div className={`diff-verdict ${improved ? 'improved' : degraded ? 'degraded' : 'neutral'}`}>
          <span className="diff-verdict-text">
            {improved ? 'Faster than baseline' : degraded ? 'Slower than baseline' : 'About the same as baseline'}
          </span>
        </div>
        <div className="diff-details">
          <Row label="Estimated cycles" current={cyclesCur} baseline={cyclesBase} />
          <Row label="L1 data misses" current={l1Misses(result)} baseline={l1Misses(baselineResult)} />
          <Row label="Misses to memory" current={memoryMisses(result)} baseline={memoryMisses(baselineResult)} />
        </div>
      </div>
    </div>
  )
}
