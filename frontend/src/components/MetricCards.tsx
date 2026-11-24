import { formatPercent } from '../utils/formatting'
import type { CacheResult, CacheStats } from '../types'

interface MetricCardsProps {
  result: CacheResult
  baselineResult?: CacheResult | null
  diffMode: boolean
}

function tone(rate: number) {
  return rate > 0.95 ? 'excellent' : rate > 0.8 ? 'good' : 'warning'
}

// In a comparison, a level's hit rate can fall while its traffic (and cost)
// falls too, so the delta is shown as the change in misses: fewer is better.
function LevelCard({ label, stats, baseline }: { label: string; stats: CacheStats; baseline?: CacheStats | null }) {
  const accesses = stats.hits + stats.misses
  const missDelta = baseline ? stats.misses - baseline.misses : 0
  return (
    <div className={`metric-card ${tone(stats.hitRate)}`}>
      <div className="metric-label">{label} hit rate</div>
      <div className="metric-value">{formatPercent(stats.hitRate)}</div>
      {baseline && missDelta !== 0 && (
        <div className={`metric-delta ${missDelta < 0 ? 'positive' : 'negative'}`}>
          {missDelta > 0 ? '+' : '−'}{Math.abs(missDelta).toLocaleString()} misses
        </div>
      )}
      <div className="metric-detail">
        {stats.misses.toLocaleString()} misses / {accesses.toLocaleString()} accesses
      </div>
    </div>
  )
}

export function MetricCards({ result, baselineResult, diffMode }: MetricCardsProps) {
  const baseline = diffMode ? baselineResult : null
  const l1 = result.levels.l1d || result.levels.l1!
  const hasL3 = (result.cacheConfig?.l3?.sizeKB ?? 1) > 0

  return (
    <div className="metric-grid">
      <LevelCard label="L1" stats={l1} baseline={baseline ? baseline.levels.l1d || baseline.levels.l1 : null} />
      <LevelCard label="L2" stats={result.levels.l2} baseline={baseline?.levels.l2} />
      {hasL3 && <LevelCard label="L3" stats={result.levels.l3} baseline={baseline?.levels.l3} />}
    </div>
  )
}
