interface PrefetchStats {
  policy: string
  issued: number
  useful: number
  accuracy: number
}

interface PrefetchStatsPanelProps {
  stats: PrefetchStats
}

export function PrefetchStatsPanel({ stats }: PrefetchStatsPanelProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Prefetching: {stats.policy}</span>
      </div>
      <div className="panel-content">
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label">Issued</div>
            <div className="metric-value">{stats.issued.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Useful</div>
            <div className="metric-value">{stats.useful.toLocaleString()}</div>
          </div>
          <div className={`metric-card ${stats.accuracy > 0.5 ? 'excellent' : stats.accuracy > 0.2 ? 'good' : 'warning'}`}>
            <div className="metric-label">Accuracy</div>
            <div className="metric-value">{(stats.accuracy * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  )
}
