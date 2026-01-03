import { useMemo, useState } from 'react'
import './CacheGrid.css'

export interface CacheLineState {
  s: number      // set
  w: number      // way
  v: number      // valid (0 or 1)
  t?: string     // tag (hex string)
  st?: string    // MESI state: M, E, S, I
  d?: number     // dirty bit
}

export interface CoreCacheState {
  core: number
  sets: number
  ways: number
  lines: CacheLineState[]
}

interface CacheGridProps {
  cacheState: CoreCacheState[]
  selectedCore?: number
  onCoreChange?: (core: number) => void
  highlightAddress?: number  // address to highlight
  compact?: boolean
}

// MESI state colors
const MESI_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  M: { bg: '#ff634780', border: '#ff6347', text: '#fff' },  // Modified - red/orange
  E: { bg: '#32cd3280', border: '#32cd32', text: '#fff' },  // Exclusive - green
  S: { bg: '#4169e180', border: '#4169e1', text: '#fff' },  // Shared - blue
  I: { bg: '#80808040', border: '#808080', text: '#aaa' },  // Invalid - gray
}

export function CacheGrid({
  cacheState,
  selectedCore = 0,
  onCoreChange,
  highlightAddress,
  compact = false
}: CacheGridProps) {
  const [hoveredLine, setHoveredLine] = useState<CacheLineState | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Get the current core's cache state
  const currentCore = useMemo(() => {
    return cacheState.find(c => c.core === selectedCore) || cacheState[0]
  }, [cacheState, selectedCore])

  // Build grid from lines array
  const grid = useMemo(() => {
    if (!currentCore) return []

    const { sets, ways, lines } = currentCore
    const gridData: (CacheLineState | null)[][] = []

    // Initialize grid with nulls
    for (let set = 0; set < sets; set++) {
      gridData[set] = Array(ways).fill(null)
    }

    // Fill in from lines array
    for (const line of lines) {
      if (line.s < sets && line.w < ways) {
        gridData[line.s][line.w] = line
      }
    }

    return gridData
  }, [currentCore])

  // Calculate which lines to highlight based on address
  const highlightedSet = useMemo(() => {
    if (highlightAddress === undefined || !currentCore) return -1
    // Calculate set index from address (assuming 64-byte cache lines)
    const lineSize = 64
    const lineAddr = Math.floor(highlightAddress / lineSize)
    return lineAddr % currentCore.sets
  }, [highlightAddress, currentCore])

  const handleMouseEnter = (
    e: React.MouseEvent,
    line: CacheLineState | null,
    _set: number,
    _way: number
  ) => {
    if (line) {
      setHoveredLine(line)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseLeave = () => {
    setHoveredLine(null)
  }

  if (!currentCore) {
    return <div className="cache-grid-empty">No cache state available</div>
  }

  const { sets, ways } = currentCore

  // For compact mode, limit displayed sets
  const displaySets = compact ? Math.min(sets, 16) : sets
  const showMoreIndicator = compact && sets > 16

  return (
    <div className={`cache-grid-container ${compact ? 'compact' : ''}`}>
      {/* Core selector for multi-core */}
      {cacheState.length > 1 && (
        <div className="core-selector">
          <label>Core:</label>
          <select
            value={selectedCore}
            onChange={(e) => onCoreChange?.(parseInt(e.target.value))}
          >
            {cacheState.map((c) => (
              <option key={c.core} value={c.core}>
                Core {c.core}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Grid header */}
      <div className="cache-grid-header">
        <div className="set-label">Set</div>
        {Array.from({ length: ways }, (_, w) => (
          <div key={w} className="way-label">
            Way {w}
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="cache-grid-body">
        {grid.slice(0, displaySets).map((row, set) => (
          <div
            key={set}
            className={`cache-grid-row ${set === highlightedSet ? 'highlighted' : ''}`}
          >
            <div className="set-index">{set}</div>
            {row.map((line, way) => {
              const state = line?.st || 'I'
              const colors = MESI_COLORS[state] || MESI_COLORS.I
              const isValid = line?.v === 1

              return (
                <div
                  key={way}
                  className={`cache-cell ${isValid ? 'valid' : 'invalid'}`}
                  style={{
                    backgroundColor: isValid ? colors.bg : 'transparent',
                    borderColor: isValid ? colors.border : '#333',
                    color: colors.text,
                  }}
                  onMouseEnter={(e) => handleMouseEnter(e, line, set, way)}
                  onMouseLeave={handleMouseLeave}
                >
                  {isValid ? state : '·'}
                </div>
              )
            })}
          </div>
        ))}

        {showMoreIndicator && (
          <div className="more-sets-indicator">
            ... {sets - 16} more sets
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mesi-legend">
        <span className="legend-title">MESI States:</span>
        {Object.entries(MESI_COLORS).map(([state, colors]) => (
          <span
            key={state}
            className="legend-item"
            style={{ backgroundColor: colors.bg, borderColor: colors.border }}
          >
            {state} = {state === 'M' ? 'Modified' : state === 'E' ? 'Exclusive' : state === 'S' ? 'Shared' : 'Invalid'}
          </span>
        ))}
      </div>

      {/* Tooltip */}
      {hoveredLine && (
        <div
          className="cache-tooltip"
          style={{
            left: tooltipPos.x + 10,
            top: tooltipPos.y + 10,
          }}
        >
          <div className="tooltip-row">
            <strong>Set:</strong> {hoveredLine.s}
          </div>
          <div className="tooltip-row">
            <strong>Way:</strong> {hoveredLine.w}
          </div>
          <div className="tooltip-row">
            <strong>State:</strong> {hoveredLine.st || 'I'} (
            {hoveredLine.st === 'M'
              ? 'Modified'
              : hoveredLine.st === 'E'
              ? 'Exclusive'
              : hoveredLine.st === 'S'
              ? 'Shared'
              : 'Invalid'}
            )
          </div>
          {hoveredLine.t && (
            <div className="tooltip-row">
              <strong>Tag:</strong> 0x{hoveredLine.t}
            </div>
          )}
          {hoveredLine.d !== undefined && (
            <div className="tooltip-row">
              <strong>Dirty:</strong> {hoveredLine.d ? 'Yes' : 'No'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default CacheGrid
