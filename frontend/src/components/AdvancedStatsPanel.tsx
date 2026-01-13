import type { AdvancedStats } from '../types'

interface AdvancedStatsPanelProps {
  stats: AdvancedStats
}

export function AdvancedStatsPanel({ stats }: AdvancedStatsPanelProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Advanced Instrumentation</span>
      </div>
      <div className="panel-content">
        <div className="advanced-stats-grid">
          {stats.vector && (
            <div className="advanced-stat-section">
              <h4>Vector/SIMD Operations</h4>
              <div className="stat-row">
                <span>Loads:</span>
                <span>{stats.vector.loads.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Stores:</span>
                <span>{stats.vector.stores.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Bytes Loaded:</span>
                <span>{(stats.vector.bytesLoaded / 1024).toFixed(1)} KB</span>
              </div>
              <div className="stat-row">
                <span>Bytes Stored:</span>
                <span>{(stats.vector.bytesStored / 1024).toFixed(1)} KB</span>
              </div>
              {stats.vector.crossLineAccesses > 0 && (
                <div className="stat-row warning">
                  <span>Cross-Line:</span>
                  <span>{stats.vector.crossLineAccesses.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
          {stats.atomic && (
            <div className="advanced-stat-section">
              <h4>Atomic Operations</h4>
              <div className="stat-row">
                <span>Loads:</span>
                <span>{stats.atomic.loads.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Stores:</span>
                <span>{stats.atomic.stores.toLocaleString()}</span>
              </div>
              {stats.atomic.rmw > 0 && (
                <div className="stat-row">
                  <span>RMW (fetch_add, etc.):</span>
                  <span>{stats.atomic.rmw.toLocaleString()}</span>
                </div>
              )}
              {stats.atomic.cmpxchg > 0 && (
                <div className="stat-row">
                  <span>CAS:</span>
                  <span>{stats.atomic.cmpxchg.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
          {stats.memoryIntrinsics && (
            <div className="advanced-stat-section">
              <h4>Memory Intrinsics</h4>
              {stats.memoryIntrinsics.memcpyCount > 0 && (
                <div className="stat-row">
                  <span>memcpy:</span>
                  <span>{stats.memoryIntrinsics.memcpyCount.toLocaleString()} ({(stats.memoryIntrinsics.memcpyBytes / 1024).toFixed(1)} KB)</span>
                </div>
              )}
              {stats.memoryIntrinsics.memsetCount > 0 && (
                <div className="stat-row">
                  <span>memset:</span>
                  <span>{stats.memoryIntrinsics.memsetCount.toLocaleString()} ({(stats.memoryIntrinsics.memsetBytes / 1024).toFixed(1)} KB)</span>
                </div>
              )}
              {stats.memoryIntrinsics.memmoveCount > 0 && (
                <div className="stat-row">
                  <span>memmove:</span>
                  <span>{stats.memoryIntrinsics.memmoveCount.toLocaleString()} ({(stats.memoryIntrinsics.memmoveBytes / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>
          )}
          {stats.softwarePrefetch && (
            <div className="advanced-stat-section">
              <h4>Software Prefetch</h4>
              <div className="stat-row">
                <span>Issued:</span>
                <span>{stats.softwarePrefetch.issued.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Useful:</span>
                <span>{stats.softwarePrefetch.useful.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Accuracy:</span>
                <span>{(stats.softwarePrefetch.accuracy * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
