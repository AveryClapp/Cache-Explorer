import { useMemo, useState } from 'react'
import './MemoryLayout.css'

export interface MemoryRegion {
  name: string
  startAddr: number
  endAddr: number
  type: 'stack' | 'heap' | 'data' | 'bss' | 'text' | 'unknown'
  accesses?: number
  misses?: number
}

export interface MemoryAccess {
  address: number
  size: number
  isWrite: boolean
  file?: string
  line?: number
  hitLevel: 1 | 2 | 3 | 4  // 1=L1, 2=L2, 3=L3, 4=memory
}

interface MemoryLayoutProps {
  regions?: MemoryRegion[]
  recentAccesses?: MemoryAccess[]
  maxAccesses?: number
  highlightAddress?: number
  onAddressClick?: (address: number) => void
}

// Default memory layout if none provided (typical x86-64 process)
const DEFAULT_REGIONS: MemoryRegion[] = [
  { name: 'Stack', startAddr: 0x7fff00000000, endAddr: 0x7fffffffffff, type: 'stack' },
  { name: 'Heap', startAddr: 0x600000000000, endAddr: 0x6fffffffffff, type: 'heap' },
  { name: 'BSS', startAddr: 0x600000, endAddr: 0x6fffff, type: 'bss' },
  { name: 'Data', startAddr: 0x500000, endAddr: 0x5fffff, type: 'data' },
  { name: 'Text', startAddr: 0x400000, endAddr: 0x4fffff, type: 'text' },
]

const REGION_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  stack: { bg: '#4a90d9', border: '#2e6eb0', text: '#fff' },
  heap: { bg: '#50c878', border: '#3a9d5c', text: '#fff' },
  data: { bg: '#dda0dd', border: '#b080b0', text: '#000' },
  bss: { bg: '#f0e68c', border: '#c4ba5c', text: '#000' },
  text: { bg: '#ff8c00', border: '#cc7000', text: '#fff' },
  unknown: { bg: '#808080', border: '#606060', text: '#fff' },
}

const HIT_LEVEL_COLORS = {
  1: '#32cd32',  // L1 hit - green
  2: '#ffd700',  // L2 hit - gold
  3: '#ffa500',  // L3 hit - orange
  4: '#ff4500',  // Memory - red
}

export function MemoryLayout({
  regions = DEFAULT_REGIONS,
  recentAccesses = [],
  maxAccesses = 100,
  highlightAddress,
  onAddressClick,
}: MemoryLayoutProps) {
  const [hoveredRegion, setHoveredRegion] = useState<MemoryRegion | null>(null)
  const [, setHoveredAccess] = useState<MemoryAccess | null>(null)
  const [viewMode, setViewMode] = useState<'regions' | 'accesses'>('regions')

  // Sort regions by address (high to low for typical stack-heap layout)
  const sortedRegions = useMemo(() => {
    return [...regions].sort((a, b) => b.startAddr - a.startAddr)
  }, [regions])

  // Group accesses by cache line
  const accessesByCacheLine = useMemo(() => {
    const lineSize = 64
    const grouped = new Map<number, MemoryAccess[]>()

    for (const access of recentAccesses.slice(-maxAccesses)) {
      const lineAddr = Math.floor(access.address / lineSize) * lineSize
      if (!grouped.has(lineAddr)) {
        grouped.set(lineAddr, [])
      }
      grouped.get(lineAddr)!.push(access)
    }

    return Array.from(grouped.entries())
      .map(([lineAddr, accesses]) => ({
        lineAddr,
        accesses,
        worstHit: Math.max(...accesses.map(a => a.hitLevel)),
        hasWrite: accesses.some(a => a.isWrite),
      }))
      .sort((a, b) => b.lineAddr - a.lineAddr)
      .slice(0, 50)  // Limit display
  }, [recentAccesses, maxAccesses])

  // Determine which region an address belongs to
  const getRegionForAddress = (addr: number): MemoryRegion | undefined => {
    return regions.find(r => addr >= r.startAddr && addr <= r.endAddr)
  }

  const formatAddress = (addr: number): string => {
    return '0x' + addr.toString(16).padStart(12, '0')
  }

  const formatSize = (size: number): string => {
    if (size >= 1024 * 1024 * 1024) {
      return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
    } else if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`
    } else if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} KB`
    }
    return `${size} B`
  }

  return (
    <div className="memory-layout-container">
      {/* View mode toggle */}
      <div className="view-mode-toggle">
        <button
          className={viewMode === 'regions' ? 'active' : ''}
          onClick={() => setViewMode('regions')}
        >
          Memory Regions
        </button>
        <button
          className={viewMode === 'accesses' ? 'active' : ''}
          onClick={() => setViewMode('accesses')}
        >
          Recent Accesses
        </button>
      </div>

      {viewMode === 'regions' ? (
        <>
          {/* Memory regions visualization */}
          <div className="memory-regions">
            <div className="address-label high">High Address</div>

            {sortedRegions.map((region, index) => {
              const colors = REGION_COLORS[region.type] || REGION_COLORS.unknown
              const size = region.endAddr - region.startAddr + 1
              const isHighlighted = highlightAddress !== undefined &&
                highlightAddress >= region.startAddr &&
                highlightAddress <= region.endAddr

              return (
                <div
                  key={index}
                  className={`memory-region ${isHighlighted ? 'highlighted' : ''}`}
                  style={{
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    color: colors.text,
                  }}
                  onMouseEnter={() => setHoveredRegion(region)}
                  onMouseLeave={() => setHoveredRegion(null)}
                  onClick={() => onAddressClick?.(region.startAddr)}
                >
                  <div className="region-name">{region.name}</div>
                  <div className="region-range">
                    {formatAddress(region.startAddr)} - {formatAddress(region.endAddr)}
                  </div>
                  <div className="region-size">{formatSize(size)}</div>
                  {region.accesses !== undefined && (
                    <div className="region-stats">
                      {region.accesses} accesses
                      {region.misses !== undefined && ` (${region.misses} misses)`}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="address-label low">Low Address</div>
          </div>

          {/* Legend */}
          <div className="memory-legend">
            {Object.entries(REGION_COLORS).filter(([type]) => type !== 'unknown').map(([type, colors]) => (
              <span
                key={type}
                className="legend-item"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Recent accesses view */}
          <div className="access-list">
            {accessesByCacheLine.length === 0 ? (
              <div className="no-accesses">No recent accesses to display</div>
            ) : (
              accessesByCacheLine.map(({ lineAddr, accesses, worstHit, hasWrite }) => {
                const region = getRegionForAddress(lineAddr)

                return (
                  <div
                    key={lineAddr}
                    className={`access-item ${highlightAddress === lineAddr ? 'highlighted' : ''}`}
                    onClick={() => onAddressClick?.(lineAddr)}
                    onMouseEnter={() => setHoveredAccess(accesses[0])}
                    onMouseLeave={() => setHoveredAccess(null)}
                  >
                    <div
                      className="access-indicator"
                      style={{ backgroundColor: HIT_LEVEL_COLORS[worstHit as keyof typeof HIT_LEVEL_COLORS] }}
                    />
                    <div className="access-address">{formatAddress(lineAddr)}</div>
                    <div className="access-type">{hasWrite ? 'R/W' : 'R'}</div>
                    <div className="access-region">{region?.name || 'Unknown'}</div>
                    <div className="access-count">{accesses.length}x</div>
                  </div>
                )
              })
            )}
          </div>

          {/* Hit level legend */}
          <div className="hit-legend">
            <span className="legend-title">Cache Level:</span>
            {[1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className="hit-item"
                style={{ backgroundColor: HIT_LEVEL_COLORS[level as keyof typeof HIT_LEVEL_COLORS] }}
              >
                {level === 4 ? 'Memory' : `L${level}`}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Tooltip for hovered region */}
      {hoveredRegion && (
        <div className="memory-tooltip">
          <div><strong>{hoveredRegion.name}</strong></div>
          <div>Start: {formatAddress(hoveredRegion.startAddr)}</div>
          <div>End: {formatAddress(hoveredRegion.endAddr)}</div>
          <div>Size: {formatSize(hoveredRegion.endAddr - hoveredRegion.startAddr + 1)}</div>
          {hoveredRegion.accesses !== undefined && (
            <div>Accesses: {hoveredRegion.accesses}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default MemoryLayout
