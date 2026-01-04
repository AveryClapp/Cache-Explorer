import { InteractiveCacheGridDisplay } from './InteractiveCacheGridDisplay'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface CacheLevelConfig {
  sizeKB: number
  assoc: number
  lineSize: number
  sets: number
}

interface CacheConfig {
  l1d: CacheLevelConfig
  l1i: CacheLevelConfig
  l2: CacheLevelConfig
  l3: CacheLevelConfig
}

interface TimelineEvent {
  i: number
  t: 'R' | 'W' | 'I'
  l: 1 | 2 | 3 | 4
  a?: number
  f?: string
  n?: number
}

interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  cacheConfig?: CacheConfig
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
  timeline?: TimelineEvent[]
  prefetch?: any
  cacheState?: any
  tlb?: any
}

interface CacheHierarchyVisualizationProps {
  result: CacheResult
  timeline?: TimelineEvent[]
  scrubberIndex?: number
  onScrubberChange?: (idx: number) => void
}

export function CacheHierarchyVisualization({
  result,
  timeline,
  scrubberIndex,
  onScrubberChange
}: CacheHierarchyVisualizationProps) {
  const config = result.cacheConfig
  const levels = result.levels

  const l1d = levels.l1d || levels.l1
  const l1i = levels.l1i
  const l2 = levels.l2
  const l3 = levels.l3

  if (!l1d) return null

  const formatSize = (kb: number) => {
    if (kb >= 1024) return `${kb / 1024} MB`
    return `${kb} KB`
  }

  const getHitRateClass = (rate: number) => {
    if (rate >= 0.95) return 'excellent'
    if (rate >= 0.8) return 'good'
    if (rate >= 0.5) return 'moderate'
    return 'poor'
  }

  const HitRateBar = ({ rate, label }: { rate: number; label: string }) => (
    <div className="hit-rate-bar">
      <div className="hit-rate-label">{label}</div>
      <div className="hit-rate-track">
        <div
          className={`hit-rate-fill ${getHitRateClass(rate)}`}
          style={{ width: `${rate * 100}%` }}
        />
      </div>
      <div className="hit-rate-value">{(rate * 100).toFixed(1)}%</div>
    </div>
  )

  return (
    <div className="cache-hierarchy-viz">
      <div className="hierarchy-title">Cache Hierarchy</div>

      <div className="hierarchy-diagram">
        {/* CPU Core */}
        <div className="hierarchy-level cpu">
          <div className="level-box cpu-box">
            <div className="box-label">CPU Core</div>
          </div>
        </div>

        {/* L1 Caches */}
        <div className="hierarchy-level l1">
          <div className={`level-box l1-box ${getHitRateClass(l1d.hitRate)}`}>
            <div className="box-label">L1 Data</div>
            {config && <div className="box-size">{formatSize(config.l1d.sizeKB)}</div>}
            <div className="box-stats">
              {l1d.hits} hits / {l1d.misses} misses
            </div>
          </div>
          {l1i && (
            <div className={`level-box l1-box ${getHitRateClass(l1i.hitRate)}`}>
              <div className="box-label">L1 Instr</div>
              {config && <div className="box-size">{formatSize(config.l1i.sizeKB)}</div>}
              <div className="box-stats">
                {l1i.hits} hits / {l1i.misses} misses
              </div>
            </div>
          )}
        </div>

        <div className="hierarchy-connector" />

        {/* L2 Cache */}
        <div className="hierarchy-level l2">
          <div className={`level-box l2-box ${getHitRateClass(l2.hitRate)}`}>
            <div className="box-label">L2 Unified</div>
            {config && <div className="box-size">{formatSize(config.l2.sizeKB)}</div>}
            <div className="box-stats">
              {l2.hits} hits / {l2.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* L3 Cache */}
        <div className="hierarchy-level l3">
          <div className={`level-box l3-box ${getHitRateClass(l3.hitRate)}`}>
            <div className="box-label">L3 Shared</div>
            {config && <div className="box-size">{formatSize(config.l3.sizeKB)}</div>}
            <div className="box-stats">
              {l3.hits} hits / {l3.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* Main Memory */}
        <div className="hierarchy-level memory">
          <div className="level-box memory-box">
            <div className="box-label">Main Memory</div>
            <div className="box-stats">{l3.misses} accesses</div>
          </div>
        </div>
      </div>

      {/* Hit Rate Bars */}
      <div className="hit-rates-section">
        <div className="hit-rates-title">Hit Rates</div>
        <HitRateBar rate={l1d.hitRate} label="L1 Data" />
        {l1i && <HitRateBar rate={l1i.hitRate} label="L1 Instr" />}
        <HitRateBar rate={l2.hitRate} label="L2" />
        <HitRateBar rate={l3.hitRate} label="L3" />
      </div>

      {/* Interactive Cache Grid with Timeline Scrubber */}
      {config && config.l1d.sets <= 64 && timeline && timeline.length > 0 && onScrubberChange && (
        <InteractiveCacheGridDisplay
          config={config.l1d}
          timeline={timeline}
          currentIndex={scrubberIndex ?? timeline.length}
          onIndexChange={onScrubberChange}
        />
      )}

      {/* Static grid fallback when no timeline */}
      {config && config.l1d.sets <= 64 && (!timeline || timeline.length === 0) && (
        <div className="cache-grid-section">
          <div className="cache-grid-title">
            L1 Data Cache Structure ({config.l1d.sets} sets × {config.l1d.assoc} ways)
          </div>
          <div className="cache-grid">
            <div className="grid-header">
              <div className="grid-corner">Set</div>
              {Array.from({ length: config.l1d.assoc }, (_, i) => (
                <div key={i} className="grid-way-label">Way {i}</div>
              ))}
            </div>
            {Array.from({ length: Math.min(config.l1d.sets, 16) }, (_, setIdx) => (
              <div key={setIdx} className="grid-row">
                <div className="grid-set-label">{setIdx}</div>
                {Array.from({ length: config.l1d.assoc }, (_, wayIdx) => (
                  <div key={wayIdx} className="grid-cell" title={`Set ${setIdx}, Way ${wayIdx}`} />
                ))}
              </div>
            ))}
            {config.l1d.sets > 16 && (
              <div className="grid-ellipsis">... {config.l1d.sets - 16} more sets</div>
            )}
          </div>
          <div className="cache-grid-legend">
            <span className="legend-item"><span className="legend-color empty" /> Empty</span>
            <span className="legend-item"><span className="legend-color valid" /> Valid</span>
            <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
          </div>
        </div>
      )}
    </div>
  )
}
