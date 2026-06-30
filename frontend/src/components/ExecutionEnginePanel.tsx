import type { ExecutionStats } from '../types'
import { formatPercent } from '../utils/formatting'

interface ExecutionEnginePanelProps {
  execution: ExecutionStats
}

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function formatLocation(file: string, line: number): string {
  const name = file.split('/').pop() || file
  return `${name}:${line}`
}

export function ExecutionEnginePanel({ execution }: ExecutionEnginePanelProps) {
  if (!execution.available) {
    return (
      <div className="panel execution-panel">
        <div className="panel-header">
          <span className="panel-title">Execution Engine</span>
          <span className="execution-badge unavailable">Unavailable</span>
        </div>
        <div className="panel-content">
          <div className="execution-unavailable">{execution.reason || 'Not available for this run.'}</div>
        </div>
      </div>
    )
  }

  const pipeline = execution.pipeline
  const branch = execution.branchPrediction

  if (!pipeline && !branch) return null

  const breakdown = pipeline?.breakdown
  const totalBreakdown = breakdown
    ? breakdown.baseCycles + breakdown.frontendStallCycles + breakdown.memoryStallCycles + breakdown.branchStallCycles
    : 0
  const basePct = breakdown ? percent(breakdown.baseCycles, totalBreakdown) : 0
  const frontendPct = breakdown ? percent(breakdown.frontendStallCycles, totalBreakdown) : 0
  const memoryPct = breakdown ? percent(breakdown.memoryStallCycles, totalBreakdown) : 0
  const branchPct = breakdown ? percent(breakdown.branchStallCycles, totalBreakdown) : 0

  return (
    <div className="panel execution-panel">
      <div className="panel-header">
        <span className="panel-title">Execution Engine</span>
        <span className="execution-badge">Estimated</span>
      </div>
      <div className="panel-content">
        {pipeline && (
          <>
            <div className="execution-metrics">
              <div className="execution-metric">
                <span className="execution-metric-label">IPC</span>
                <span className="execution-metric-value">{pipeline.ipc.toFixed(2)}</span>
              </div>
              <div className="execution-metric">
                <span className="execution-metric-label">CPI</span>
                <span className="execution-metric-value">{pipeline.cpi.toFixed(2)}</span>
              </div>
              <div className="execution-metric">
                <span className="execution-metric-label">Cycles</span>
                <span className="execution-metric-value">{pipeline.cycles.toLocaleString()}</span>
              </div>
              <div className="execution-metric">
                <span className="execution-metric-label">Instructions</span>
                <span className="execution-metric-value">{pipeline.instructions.toLocaleString()}</span>
              </div>
            </div>

            {breakdown && totalBreakdown > 0 && (
              <>
                <div className="execution-bar" aria-label="Execution cycle breakdown">
                  {basePct > 0 && (
                    <div
                      className="execution-segment base"
                      style={{ width: `${basePct}%` }}
                      title={`Base: ${breakdown.baseCycles.toLocaleString()} cycles`}
                    />
                  )}
                  {frontendPct > 0 && (
                    <div
                      className="execution-segment frontend"
                      style={{ width: `${frontendPct}%` }}
                      title={`Front end: ${breakdown.frontendStallCycles.toLocaleString()} cycles`}
                    />
                  )}
                  {memoryPct > 0 && (
                    <div
                      className="execution-segment memory"
                      style={{ width: `${memoryPct}%` }}
                      title={`Memory: ${breakdown.memoryStallCycles.toLocaleString()} cycles`}
                    />
                  )}
                  {branchPct > 0 && (
                    <div
                      className="execution-segment branch"
                      style={{ width: `${branchPct}%` }}
                      title={`Branch: ${breakdown.branchStallCycles.toLocaleString()} cycles`}
                    />
                  )}
                </div>
                <div className="execution-legend">
                  <span><span className="execution-dot base" />Base {basePct.toFixed(0)}%</span>
                  {frontendPct > 0 && <span><span className="execution-dot frontend" />Front {frontendPct.toFixed(0)}%</span>}
                  {memoryPct > 0 && <span><span className="execution-dot memory" />Memory {memoryPct.toFixed(0)}%</span>}
                  {branchPct > 0 && <span><span className="execution-dot branch" />Branch {branchPct.toFixed(0)}%</span>}
                </div>
              </>
            )}
          </>
        )}

        {branch && branch.total > 0 && (
          <div className="execution-branches">
            <div className="execution-section-header">
              <span>Branch Prediction</span>
              <span>{formatPercent(branch.accuracy)} accuracy</span>
            </div>
            <div className="stat-row">
              <span>Branches</span>
              <span>{branch.total.toLocaleString()}</span>
            </div>
            <div className="stat-row">
              <span>Mispredicts</span>
              <span>{branch.mispredictions.toLocaleString()}</span>
            </div>
            {branch.hotBranches.length > 0 && (
              <div className="execution-hot-branches">
                {branch.hotBranches
                  .filter(site => site.mispredictions > 0)
                  .slice(0, 5)
                  .map(site => (
                    <div className="execution-branch-row" key={`${site.file}:${site.line}`}>
                      <span className="execution-branch-location">{formatLocation(site.file, site.line)}</span>
                      <span>
                        {site.mispredictions.toLocaleString()}/{site.total.toLocaleString()} (
                        {formatPercent(site.mispredictionRate)})
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
