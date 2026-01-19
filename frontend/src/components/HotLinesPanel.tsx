import { formatPercent } from '../utils/formatting'
import type { HotLine } from '../types'
import type { editor } from 'monaco-editor'

interface HotLinesPanelProps {
  hotLines: HotLine[]
  baselineHotLines?: HotLine[]
  diffMode?: boolean
  code: string
  selectedFile: string
  onFileChange: (file: string) => void
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
}

interface HotLineWithDelta extends HotLine {
  delta?: number
  isNew?: boolean
  isResolved?: boolean
}

export function HotLinesPanel({ hotLines, baselineHotLines, diffMode, code, selectedFile, onFileChange, editorRef }: HotLinesPanelProps) {
  // Filter hotlines to only show those with more than 1 total access
  const significantHotLines = hotLines.filter(h => (h.hits + h.misses) > 1)

  if (significantHotLines.length === 0) return null

  // Build lookup for baseline by source location
  const baselineLookup = new Map<string, HotLine>()
  if (diffMode && baselineHotLines) {
    for (const line of baselineHotLines) {
      const key = `${line.file}:${line.line}`
      baselineLookup.set(key, line)
    }
  }

  // Compute deltas and track matched baseline lines
  const matchedKeys = new Set<string>()
  let hotLinesWithDelta: HotLineWithDelta[] = significantHotLines.map(h => {
    const key = `${h.file}:${h.line}`
    const baseline = baselineLookup.get(key)
    if (baseline) {
      matchedKeys.add(key)
      return { ...h, delta: h.misses - baseline.misses }
    }
    return { ...h, isNew: diffMode }
  })

  // Resolved lines: in baseline but not in current (improved and dropped off)
  const resolvedLines: HotLineWithDelta[] = diffMode && baselineHotLines
    ? baselineHotLines
        .filter(h => {
          const key = `${h.file}:${h.line}`
          return !matchedKeys.has(key) && (h.hits + h.misses) > 1
        })
        .map(h => ({ ...h, isResolved: true, delta: -h.misses }))
    : []

  // Sort: regressions first (positive delta), then by miss count
  if (diffMode) {
    hotLinesWithDelta.sort((a, b) => {
      if (a.isNew && !b.isNew) return -1
      if (!a.isNew && b.isNew) return 1
      const deltaA = a.delta ?? 0
      const deltaB = b.delta ?? 0
      if (deltaA !== deltaB) return deltaB - deltaA
      return b.misses - a.misses
    })
  }

  const filteredLines = hotLinesWithDelta.filter(h => !selectedFile || h.file === selectedFile)
  const maxMisses = Math.max(...filteredLines.slice(0, 10).map(h => h.misses), 1)
  const uniqueFiles = new Set(significantHotLines.map(h => h.file).filter(Boolean))

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Hot Lines</span>
        <span className="panel-badge">{significantHotLines.length}</span>
      </div>
      {/* File filter dropdown - only show if multiple files */}
      {uniqueFiles.size > 1 && (
        <div className="file-filter" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <label htmlFor="hot-line-file-select" style={{ marginRight: '8px', fontSize: '12px' }}>Filter by file:</label>
          <select
            id="hot-line-file-select"
            value={selectedFile}
            onChange={(e) => onFileChange(e.target.value)}
            style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <option value="">All files</option>
            {Array.from(uniqueFiles).sort().map(file => (
              <option key={file} value={file}>{file?.split('/').pop()}</option>
            ))}
          </select>
        </div>
      )}
      <div className="hotspots">
        {filteredLines.slice(0, 10).map((hotLine, i) => {
          const barWidth = maxMisses > 0 ? (hotLine.misses / maxMisses) * 100 : 0
          const lines = code.split('\n')
          // Only show code preview if this hotline is from the selected file (or only one file exists)
          const isCurrentFile = uniqueFiles.size === 1 || (selectedFile && hotLine.file === selectedFile)
          const sourceLine = isCurrentFile ? lines[hotLine.line - 1]?.trim() : null

          // Determine CSS classes based on delta state
          const hotspotClasses = ['hotspot']
          if (diffMode && hotLine.isNew) {
            hotspotClasses.push('hotspot-new')
          } else if (diffMode && hotLine.delta !== undefined && hotLine.delta > 0) {
            hotspotClasses.push('hotspot-regression')
          }

          return (
            <div
              key={i}
              className={hotspotClasses.join(' ')}
              onClick={() => {
                if (editorRef.current && hotLine.line > 0 && isCurrentFile) {
                  editorRef.current.revealLineInCenter(hotLine.line)
                  editorRef.current.setPosition({ lineNumber: hotLine.line, column: 1 })
                  editorRef.current.focus()
                }
              }}
            >
              <div className="hotspot-header">
                <span className="hotspot-location">
                  {hotLine.file ? `${hotLine.file.split('/').pop()}:` : ''}Line {hotLine.line}
                  {hotLine.isNew && <span className="hotspot-badge new">NEW</span>}
                </span>
                <span className="hotspot-stats">
                  {hotLine.misses.toLocaleString()} misses
                  {diffMode && hotLine.delta !== undefined && hotLine.delta !== 0 && (
                    <span className={`hotspot-delta ${hotLine.delta > 0 ? 'negative' : 'positive'}`}>
                      {hotLine.delta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(hotLine.delta).toLocaleString()}
                    </span>
                  )}
                  <span className="hotspot-rate">({formatPercent(hotLine.missRate)})</span>
                </span>
              </div>
              {/* Source code preview - only show if from current file */}
              {sourceLine && (
                <div className="hotspot-code">
                  <code>{sourceLine}</code>
                </div>
              )}
              <div className="hotspot-bar">
                <div
                  className="hotspot-bar-fill"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Resolved section - lines that improved and dropped off hot list */}
      {diffMode && resolvedLines.length > 0 && (
        <details className="resolved-section">
          <summary className="resolved-header">
            <span className="resolved-icon">✓</span>
            {resolvedLines.length} Resolved Hot Line{resolvedLines.length !== 1 ? 's' : ''}
          </summary>
          <div className="hotspots resolved">
            {resolvedLines.slice(0, 5).map((hotLine, i) => (
              <div key={i} className="hotspot hotspot-resolved">
                <div className="hotspot-header">
                  <span className="hotspot-location">
                    {hotLine.file ? `${hotLine.file.split('/').pop()}:` : ''}Line {hotLine.line}
                  </span>
                  <span className="hotspot-stats resolved">
                    Was {hotLine.misses.toLocaleString()} misses
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
