import { useState, useRef, useEffect, useMemo } from 'react'

interface TimelineEvent {
  i: number
  t: 'R' | 'W' | 'I'
  l: 1 | 2 | 3 | 4
  a?: number
  f?: string
  n?: number
}

interface CacheLevelConfig {
  sizeKB: number
  assoc: number
  lineSize: number
  sets: number
}

interface CacheLine {
  valid: boolean
  tag: number
  dirty: boolean
  lastAccess: number
  accessCount: number
}

interface InteractiveCacheGridDisplayProps {
  config: CacheLevelConfig
  timeline: TimelineEvent[]
  currentIndex: number
  onIndexChange: (idx: number) => void
}

export function InteractiveCacheGridDisplay({
  config,
  timeline,
  currentIndex,
  onIndexChange
}: InteractiveCacheGridDisplayProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(10)  // events per second
  const playRef = useRef<number | null>(null)

  // Calculate running stats up to current index
  const runningStats = useMemo(() => {
    let hits = 0, misses = 0, reads = 0, writes = 0
    for (let i = 0; i < currentIndex; i++) {
      const e = timeline[i]
      if (e.l === 1) hits++
      else misses++
      if (e.t === 'R') reads++
      else if (e.t === 'W') writes++
    }
    return { hits, misses, reads, writes }
  }, [timeline, currentIndex])

  // Find next miss event
  const findNextMiss = () => {
    for (let i = currentIndex; i < timeline.length; i++) {
      if (timeline[i].l !== 1) {  // Not an L1 hit
        return i + 1  // Return 1-indexed position
      }
    }
    return timeline.length  // No more misses, go to end
  }

  // Find previous miss event
  const findPrevMiss = () => {
    for (let i = currentIndex - 2; i >= 0; i--) {
      if (timeline[i].l !== 1) {  // Not an L1 hit
        return i + 1  // Return 1-indexed position
      }
    }
    return 0  // No previous miss, go to start
  }

  // Compute cache state up to currentIndex
  const cacheState = useMemo(() => {
    const numSets = config.sets
    const assoc = config.assoc
    const lineSize = config.lineSize

    const cache: CacheLine[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, () => ({
        valid: false,
        tag: 0,
        dirty: false,
        lastAccess: -1,
        accessCount: 0
      }))
    )

    const lruOrder: number[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, (_, i) => i)
    )

    for (let i = 0; i < Math.min(currentIndex, timeline.length); i++) {
      const event = timeline[i]
      if (!event.a || event.t === 'I') continue

      const addr = event.a
      const setIndex = Math.floor(addr / lineSize) % numSets
      const tag = Math.floor(addr / lineSize / numSets)
      const isWrite = event.t === 'W'

      const set = cache[setIndex]
      const lru = lruOrder[setIndex]

      let hitWay = -1
      for (let way = 0; way < assoc; way++) {
        if (set[way].valid && set[way].tag === tag) {
          hitWay = way
          break
        }
      }

      if (hitWay >= 0) {
        // Hit - update LRU and access info
        set[hitWay].lastAccess = i
        set[hitWay].accessCount++
        if (isWrite) set[hitWay].dirty = true

        // Move to MRU position
        const idx = lru.indexOf(hitWay)
        lru.splice(idx, 1)
        lru.push(hitWay)
      } else {
        // Miss - find victim (LRU) and replace
        const victimWay = lru[0]
        set[victimWay] = {
          valid: true,
          tag,
          dirty: isWrite,
          lastAccess: i,
          accessCount: 1
        }

        // Move to MRU position
        lru.shift()
        lru.push(victimWay)
      }
    }

    return cache
  }, [config, timeline, currentIndex])

  // Playback control
  useEffect(() => {
    if (isPlaying && currentIndex < timeline.length) {
      playRef.current = window.setInterval(() => {
        onIndexChange(Math.min(currentIndex + 1, timeline.length))
      }, 1000 / playSpeed)
    }
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current)
        playRef.current = null
      }
    }
  }, [isPlaying, currentIndex, timeline.length, playSpeed, onIndexChange])

  // Stop playing when reaching end
  useEffect(() => {
    if (currentIndex >= timeline.length) {
      setIsPlaying(false)
    }
  }, [currentIndex, timeline.length])

  const getHeatColor = (line: CacheLine, maxIndex: number) => {
    if (!line.valid) return 'empty'
    const recency = maxIndex > 0 ? (line.lastAccess / maxIndex) : 0
    if (recency > 0.9) return 'hot'
    if (recency > 0.5) return 'warm'
    if (recency > 0.1) return 'cool'
    return 'cold'
  }

  const currentEvent = timeline[currentIndex - 1]
  const currentSet = currentEvent?.a
    ? Math.floor(currentEvent.a / config.lineSize) % config.sets
    : -1

  return (
    <div className="interactive-cache-grid">
      <div className="cache-grid-header">
        <div className="cache-grid-title">
          L1D Cache State ({config.sets} sets × {config.assoc} ways)
        </div>
        <div className="scrubber-controls">
          <button
            className="play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={currentIndex >= timeline.length}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
            disabled={currentIndex <= 0}
            title="Previous event"
          >
            ◀
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.min(timeline.length, currentIndex + 1))}
            disabled={currentIndex >= timeline.length}
            title="Next event"
          >
            ▶
          </button>
          <div className="step-divider" />
          <button
            className="step-btn skip-miss"
            onClick={() => onIndexChange(findPrevMiss())}
            disabled={currentIndex <= 0}
            title="Previous miss"
          >
            ⏮
          </button>
          <button
            className="step-btn skip-miss"
            onClick={() => onIndexChange(findNextMiss())}
            disabled={currentIndex >= timeline.length}
            title="Next miss"
          >
            ⏭
          </button>
          <select
            className="speed-select"
            value={playSpeed}
            onChange={(e) => setPlaySpeed(Number(e.target.value))}
            title="Playback speed"
          >
            <option value={1}>1x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
            <option value={50}>50x</option>
            <option value={100}>100x</option>
          </select>
        </div>
        <div className="running-stats">
          <span className="stat-hit" title="L1 Hits">{runningStats.hits} hits</span>
          <span className="stat-miss" title="L1 Misses">{runningStats.misses} miss</span>
          <span className="stat-ratio" title="Hit Rate">
            {currentIndex > 0 ? ((runningStats.hits / currentIndex) * 100).toFixed(1) : 0}%
          </span>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="timeline-scrubber">
        <input
          type="range"
          min={0}
          max={timeline.length}
          value={currentIndex}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="scrubber-slider"
        />
        <div className="scrubber-info">
          <span>Event {currentIndex} / {timeline.length}</span>
        </div>
        {currentEvent && (
          <div className="current-event-details">
            <span className={`event-type ${currentEvent.t === 'R' ? 'read' : currentEvent.t === 'W' ? 'write' : 'fetch'}`}>
              {currentEvent.t === 'R' ? 'READ' : currentEvent.t === 'W' ? 'WRITE' : 'FETCH'}
            </span>
            <span className={`event-result ${currentEvent.l === 1 ? 'l1' : currentEvent.l === 2 ? 'l2' : currentEvent.l === 3 ? 'l3' : 'mem'}`}>
              {currentEvent.l === 1 ? 'L1 Hit' : currentEvent.l === 2 ? 'L2 Hit' : currentEvent.l === 3 ? 'L3 Hit' : 'Memory'}
            </span>
            {currentEvent.a && (
              <span className="event-address">0x{currentEvent.a.toString(16).padStart(8, '0')}</span>
            )}
            {currentSet >= 0 && (
              <span className="event-set">Set {currentSet}</span>
            )}
            {currentEvent.f && currentEvent.n && (
              <span className="event-source">{currentEvent.f}:{currentEvent.n}</span>
            )}
          </div>
        )}
      </div>

      {/* Cache grid */}
      <div className="cache-grid animated">
        <div className="grid-header">
          <div className="grid-corner">Set</div>
          {Array.from({ length: config.assoc }, (_, i) => (
            <div key={i} className="grid-way-label">W{i}</div>
          ))}
        </div>
        {Array.from({ length: Math.min(config.sets, 16) }, (_, setIdx) => (
          <div
            key={setIdx}
            className={`grid-row ${setIdx === currentSet ? 'active-set' : ''}`}
          >
            <div className="grid-set-label">{setIdx}</div>
            {cacheState[setIdx].map((line: CacheLine, wayIdx: number) => (
              <div
                key={wayIdx}
                className={`grid-cell ${getHeatColor(line, currentIndex)} ${line.dirty ? 'dirty' : ''}`}
                title={line.valid
                  ? `Tag: 0x${line.tag.toString(16)}\nAccesses: ${line.accessCount}\nLast: #${line.lastAccess}${line.dirty ? '\n(dirty)' : ''}`
                  : 'Empty'
                }
              >
                {line.valid && (
                  <span className="cell-tag">
                    {line.accessCount > 1 ? line.accessCount : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {config.sets > 16 && (
          <div className="grid-ellipsis">... {config.sets - 16} more sets</div>
        )}
      </div>

      <div className="cache-grid-legend">
        <span className="legend-item"><span className="legend-color empty" /> Empty</span>
        <span className="legend-item"><span className="legend-color cold" /> Cold</span>
        <span className="legend-item"><span className="legend-color cool" /> Cool</span>
        <span className="legend-item"><span className="legend-color warm" /> Warm</span>
        <span className="legend-item"><span className="legend-color hot" /> Hot</span>
        <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
      </div>
    </div>
  )
}
