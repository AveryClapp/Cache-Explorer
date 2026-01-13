import { formatPercent } from '../utils/formatting'
import type { CacheResult } from '../types'

interface DiffSummaryProps {
  result: CacheResult
  baselineResult: CacheResult
}

export function DiffSummary({ result, baselineResult }: DiffSummaryProps) {
  const l1Cur = (result.levels.l1d || result.levels.l1!).hitRate
  const l1Base = (baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate ?? 0
  const l1Diff = l1Cur - l1Base
  const cyclesCur = result.timing?.totalCycles ?? 0
  const cyclesBase = baselineResult.timing?.totalCycles ?? 0
  const cyclesDiff = cyclesBase > 0 ? ((cyclesCur - cyclesBase) / cyclesBase * 100) : 0
  const improved = l1Diff > 0.01 || cyclesDiff < -5
  const degraded = l1Diff < -0.01 || cyclesDiff > 5

  return (
    <div className="diff-summary panel">
      <div className="panel-header">
        <span className="panel-title">Comparison Summary</span>
      </div>
      <div className="diff-summary-content">
        <div className={`diff-verdict ${improved ? 'improved' : degraded ? 'degraded' : 'neutral'}`}>
          <span className="diff-verdict-icon">{improved ? '↑' : degraded ? '↓' : '='}</span>
          <span className="diff-verdict-text">
            {improved ? 'Performance Improved' : degraded ? 'Performance Degraded' : 'Similar Performance'}
          </span>
        </div>
        <div className="diff-details">
          <div className="diff-detail">
            <span>L1 Hit Rate:</span>
            <span>{formatPercent((result.levels.l1d || result.levels.l1!).hitRate)} vs {formatPercent((baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate ?? 0)}</span>
          </div>
          {result.timing && baselineResult.timing && (
            <div className="diff-detail">
              <span>Cycles:</span>
              <span>{result.timing.totalCycles.toLocaleString()} vs {baselineResult.timing.totalCycles.toLocaleString()}</span>
            </div>
          )}
          <div className="diff-detail">
            <span>Events:</span>
            <span>{result.events.toLocaleString()} vs {baselineResult.events.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
