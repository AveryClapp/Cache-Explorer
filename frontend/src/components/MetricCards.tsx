import { formatPercent, formatDelta } from '../utils/formatting'
import type { CacheResult } from '../types'

interface MetricCardsProps {
  result: CacheResult
  baselineResult?: CacheResult | null
  diffMode: boolean
}

export function MetricCards({ result, baselineResult, diffMode }: MetricCardsProps) {
  const l1Rate = (result.levels.l1d || result.levels.l1!).hitRate
  const l1Baseline = baselineResult ? (baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate : null
  const l1Delta = diffMode && l1Baseline != null ? formatDelta(l1Rate, l1Baseline) : null

  const l2Rate = result.levels.l2.hitRate
  const l2Baseline = baselineResult?.levels.l2?.hitRate
  const l2Delta = diffMode && l2Baseline != null ? formatDelta(l2Rate, l2Baseline) : null

  const l3Rate = result.levels.l3.hitRate
  const l3Baseline = baselineResult?.levels.l3?.hitRate
  const l3Delta = diffMode && l3Baseline != null ? formatDelta(l3Rate, l3Baseline) : null

  return (
    <div className="metric-grid">
      <div className={`metric-card ${l1Rate > 0.95 ? 'excellent' : l1Rate > 0.8 ? 'good' : 'warning'}`}>
        <div className="metric-label">L1 Hit Rate</div>
        <div className="metric-value">{formatPercent(l1Rate)}</div>
        {l1Delta && !l1Delta.isNeutral && (
          <div className={`metric-delta ${l1Delta.isPositive ? 'positive' : 'negative'}`}>
            {l1Delta.text}
          </div>
        )}
        <div className="metric-detail">
          {(result.levels.l1d || result.levels.l1!).hits.toLocaleString()} hits
        </div>
      </div>

      <div className={`metric-card ${l2Rate > 0.95 ? 'excellent' : l2Rate > 0.8 ? 'good' : 'warning'}`}>
        <div className="metric-label">L2 Hit Rate</div>
        <div className="metric-value">{formatPercent(l2Rate)}</div>
        {l2Delta && !l2Delta.isNeutral && (
          <div className={`metric-delta ${l2Delta.isPositive ? 'positive' : 'negative'}`}>
            {l2Delta.text}
          </div>
        )}
        <div className="metric-detail">{result.levels.l2.hits.toLocaleString()} hits</div>
      </div>

      <div className={`metric-card ${l3Rate > 0.95 ? 'excellent' : l3Rate > 0.8 ? 'good' : 'warning'}`}>
        <div className="metric-label">L3 Hit Rate</div>
        <div className="metric-value">{formatPercent(l3Rate)}</div>
        {l3Delta && !l3Delta.isNeutral && (
          <div className={`metric-delta ${l3Delta.isPositive ? 'positive' : 'negative'}`}>
            {l3Delta.text}
          </div>
        )}
        <div className="metric-detail">{result.levels.l3.hits.toLocaleString()} hits</div>
      </div>
    </div>
  )
}
