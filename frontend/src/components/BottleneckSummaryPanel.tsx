import type { BottleneckSummary } from '../types'
import { formatPercent } from '../utils/formatting'

interface BottleneckSummaryPanelProps {
  summary: BottleneckSummary
}

function formatSubsystem(name: string) {
  return name.replace(/-/g, ' ')
}

function formatLocation(file: string, line: number) {
  const name = file.split('/').pop() || file
  return `${name}:${line}`
}

export function BottleneckSummaryPanel({ summary }: BottleneckSummaryPanelProps) {
  const bottleneck = formatSubsystem(summary.primaryBottleneck)
  const topSource = summary.topSource

  return (
    <div className={`panel bottleneck-panel ${summary.primaryBottleneck}`}>
      <div className="panel-header">
        <span className="panel-title">Primary Bottleneck</span>
        <span className={`bottleneck-confidence ${summary.confidence}`}>{summary.confidence}</span>
      </div>
      <div className="panel-content">
        <div className="bottleneck-summary">
          <div>
            <div className="bottleneck-name">{bottleneck}</div>
            <div className="bottleneck-reason">{summary.reason}</div>
          </div>
          <div className="bottleneck-cycle-block">
            <span>{summary.estimatedCycles.toLocaleString()}</span>
            <span>cycles</span>
          </div>
        </div>
        <div className="bottleneck-detail-grid">
          <div className="bottleneck-detail-row">
            <span>Share</span>
            <span>{formatPercent(summary.bottleneckShare)}</span>
          </div>
          {topSource && (
            <div className="bottleneck-detail-row">
              <span>Top Source</span>
              <span>{formatLocation(topSource.file, topSource.line)}</span>
            </div>
          )}
          {topSource && (
            <div className="bottleneck-detail-row">
              <span>Source Cycles</span>
              <span>{topSource.cycles.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
