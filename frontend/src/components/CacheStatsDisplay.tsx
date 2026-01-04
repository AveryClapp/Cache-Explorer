import { formatPercent } from '../utils/formatting'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  cacheConfig?: any
  levels: {
    l1?: CacheStats
    l1d?: CacheStats
    l1i?: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  coherence?: any
  hotLines: any[]
  falseSharing?: any[]
  suggestions?: any[]
  timeline?: any[]
  prefetch?: any
  cacheState?: any
  tlb?: any
}

interface CacheStatsDisplayProps {
  result: CacheResult
}

export function CacheStatsDisplay({ result }: CacheStatsDisplayProps) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getRateClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'

  return (
    <div className="cache-stats">
      <div className="cache-stat">
        <span className="cache-stat-label">L1 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l1d.hitRate)}`}>{formatPercent(l1d.hitRate)}</span>
        <span className="cache-stat-detail">{l1d.hits.toLocaleString()} / {(l1d.hits + l1d.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">L2 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l2.hitRate)}`}>{formatPercent(l2.hitRate)}</span>
        <span className="cache-stat-detail">{l2.hits.toLocaleString()} / {(l2.hits + l2.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">L3 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l3.hitRate)}`}>{formatPercent(l3.hitRate)}</span>
        <span className="cache-stat-detail">{l3.hits.toLocaleString()} / {(l3.hits + l3.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">Total Events</span>
        <span className="cache-stat-value">{result.events.toLocaleString()}</span>
        <span className="cache-stat-detail">{result.config}</span>
      </div>
    </div>
  )
}
