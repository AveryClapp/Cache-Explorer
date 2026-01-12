import type { TimingStats } from '../types'
import { formatNumericDelta } from '../utils/formatting'

interface TimingDisplayProps {
  timing: TimingStats
  baselineTiming?: TimingStats | null
  diffMode?: boolean
}

export function TimingDisplay({ timing, baselineTiming, diffMode }: TimingDisplayProps) {
  const { breakdown, totalCycles, avgLatency } = timing
  const totalBreakdown = breakdown.l1HitCycles + breakdown.l2HitCycles + breakdown.l3HitCycles + breakdown.memoryCycles

  // Calculate percentages for breakdown bar
  const l1Pct = totalBreakdown > 0 ? (breakdown.l1HitCycles / totalBreakdown) * 100 : 0
  const l2Pct = totalBreakdown > 0 ? (breakdown.l2HitCycles / totalBreakdown) * 100 : 0
  const l3Pct = totalBreakdown > 0 ? (breakdown.l3HitCycles / totalBreakdown) * 100 : 0
  const memPct = totalBreakdown > 0 ? (breakdown.memoryCycles / totalBreakdown) * 100 : 0

  // Calculate deltas for diff mode
  const cyclesDelta = diffMode && baselineTiming ? formatNumericDelta(totalCycles, baselineTiming.totalCycles) : null

  return (
    <div className="timing-display">
      <div className="timing-header">
        <span className="timing-label">Timing</span>
        <span className="timing-value">
          {totalCycles.toLocaleString()}
          {cyclesDelta && (
            <span className={`timing-delta ${cyclesDelta.isNeutral ? 'neutral' : cyclesDelta.isWorse ? 'worse' : 'better'}`}>
              {cyclesDelta.text}
            </span>
          )}
        </span>
        <span className="timing-unit">cycles ({avgLatency.toFixed(1)} avg)</span>
      </div>
      <div className="timing-bar">
        {l1Pct > 0 && <div className="timing-segment l1" style={{ width: `${l1Pct}%` }} title={`L1: ${breakdown.l1HitCycles.toLocaleString()} cycles`} />}
        {l2Pct > 0 && <div className="timing-segment l2" style={{ width: `${l2Pct}%` }} title={`L2: ${breakdown.l2HitCycles.toLocaleString()} cycles`} />}
        {l3Pct > 0 && <div className="timing-segment l3" style={{ width: `${l3Pct}%` }} title={`L3: ${breakdown.l3HitCycles.toLocaleString()} cycles`} />}
        {memPct > 0 && <div className="timing-segment mem" style={{ width: `${memPct}%` }} title={`Memory: ${breakdown.memoryCycles.toLocaleString()} cycles`} />}
      </div>
      <div className="timing-legend">
        {l1Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l1" />L1 {l1Pct.toFixed(0)}%</span>}
        {l2Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l2" />L2 {l2Pct.toFixed(0)}%</span>}
        {l3Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l3" />L3 {l3Pct.toFixed(0)}%</span>}
        {memPct > 0 && <span className="timing-legend-item"><span className="timing-dot mem" />Mem {memPct.toFixed(0)}%</span>}
      </div>
    </div>
  )
}
