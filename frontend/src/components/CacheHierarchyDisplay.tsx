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
  prefetch?: any
  cacheState?: any
  tlb?: any
}

interface CacheHierarchyDisplayProps {
  result: CacheResult
}

export function CacheHierarchyDisplay({ result }: CacheHierarchyDisplayProps) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l1i = result.levels.l1i
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getRateClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'

  return (
    <div className="cache-hierarchy">
      {/* L1 Row */}
      <div className="cache-level-row">
        <div className={`cache-box ${getRateClass(l1d.hitRate)}`} title={`${l1d.hits.toLocaleString()} hits, ${l1d.misses.toLocaleString()} misses`}>
          <span className="cache-box-rate">{formatPercent(l1d.hitRate)}</span>
          <span className="cache-box-label">L1 Data</span>
        </div>
        {l1i && (
          <div className={`cache-box ${getRateClass(l1i.hitRate)}`} title={`${l1i.hits.toLocaleString()} hits, ${l1i.misses.toLocaleString()} misses`}>
            <span className="cache-box-rate">{formatPercent(l1i.hitRate)}</span>
            <span className="cache-box-label">L1 Instr</span>
          </div>
        )}
      </div>

      <div className="cache-connector" />

      {/* L2 */}
      <div className={`cache-box ${getRateClass(l2.hitRate)}`} title={`${l2.hits.toLocaleString()} hits, ${l2.misses.toLocaleString()} misses`}>
        <span className="cache-box-rate">{formatPercent(l2.hitRate)}</span>
        <span className="cache-box-label">L2 Cache</span>
      </div>

      <div className="cache-connector" />

      {/* L3 */}
      <div className={`cache-box ${getRateClass(l3.hitRate)}`} title={`${l3.hits.toLocaleString()} hits, ${l3.misses.toLocaleString()} misses`}>
        <span className="cache-box-rate">{formatPercent(l3.hitRate)}</span>
        <span className="cache-box-label">L3 Cache</span>
      </div>

      <div className="cache-connector" />

      {/* Memory */}
      <div className="cache-memory">
        Memory ({(l1d.misses + (l1i?.misses || 0) - l2.hits - l3.hits).toLocaleString()} accesses)
      </div>
    </div>
  )
}
