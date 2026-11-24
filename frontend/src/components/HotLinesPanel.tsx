import { formatPercent } from '../utils/formatting'
import { sourceLineKey } from '../utils/sourcePath'
import {
  LINE_METRICS,
  availableLineMetrics,
  formatMetricCount,
  lineMetricInfo,
  lineMetricValue,
  type LineMetric,
} from '../utils/lineMetrics'
import type { HotLine } from '../types'
import type { editor } from 'monaco-editor'

interface HotLinesPanelProps {
  hotLines: HotLine[]
  baselineHotLines?: HotLine[]
  diffMode?: boolean
  code: string
  selectedFile: string
  onFileChange: (file: string) => void
  metric: LineMetric
  onMetricChange: (metric: LineMetric) => void
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
}

interface RankedLine extends HotLine {
  value: number
  delta?: number
  isNew?: boolean
}

const fileName = (path: string) => path.split(/[/\\]/).pop() || path

export function HotLinesPanel({
  hotLines,
  baselineHotLines,
  diffMode,
  code,
  selectedFile,
  onFileChange,
  metric,
  onMetricChange,
  editorRef,
}: HotLinesPanelProps) {
  const info = lineMetricInfo(metric)
  const metrics = availableLineMetrics(hotLines)
  const valueOf = (line: HotLine) => lineMetricValue(line, metric)
  // A miss on a line touched once is noise, not a hot spot.
  const counts = (line: HotLine) =>
    valueOf(line) > 0 && (metric === 'stallCycles' || metric === 'branchMispredictions' || line.hits + line.misses > 1)

  const significant = hotLines.filter(counts)
  const total = significant.reduce((sum, line) => sum + valueOf(line), 0) || 1

  // Only compare against a baseline that reports the same metric.
  const comparable = Boolean(diffMode && baselineHotLines?.some(line => info.read(line) !== undefined))
  const baselineLookup = new Map<string, HotLine>()
  if (comparable) {
    for (const line of baselineHotLines!) baselineLookup.set(sourceLineKey(line.file, line.line), line)
  }

  const matchedKeys = new Set<string>()
  const ranked: RankedLine[] = significant.map(line => {
    const key = sourceLineKey(line.file, line.line)
    const baseline = baselineLookup.get(key)
    const value = valueOf(line)
    if (baseline && valueOf(baseline) > 0) {
      matchedKeys.add(key)
      return { ...line, value, delta: value - valueOf(baseline) }
    }
    return { ...line, value, isNew: comparable }
  })

  const resolved = comparable
    ? baselineHotLines!.filter(line => counts(line) && !matchedKeys.has(sourceLineKey(line.file, line.line)))
    : []

  if (comparable) {
    // Regressions (new or grown lines) first, largest first.
    const regression = (line: RankedLine) => line.isNew ? line.value : Math.max(line.delta ?? 0, 0)
    ranked.sort((a, b) => regression(b) - regression(a) || b.value - a.value)
  } else {
    ranked.sort((a, b) => b.value - a.value)
  }

  if (ranked.length === 0 && metrics.length <= 1) return null

  const filtered = ranked.filter(line => !selectedFile || line.file === selectedFile)
  const shown = filtered.slice(0, 10)
  const maxValue = Math.max(...shown.map(line => line.value), 1)
  const uniqueFiles = new Set(significant.map(line => line.file).filter(Boolean))
  const sourceLines = code.split('\n')

  return (
    <div className="panel hotlines-panel">
      <div className="panel-header">
        <span className="panel-title">Hot lines</span>
        <span className="panel-badge">{ranked.length}</span>
        {metrics.length > 1 && (
          <label className="hotline-metric" title={info.hint}>
            <span>Rank by</span>
            <select
              value={metric}
              onChange={event => onMetricChange(event.target.value as LineMetric)}
              aria-label="Rank hot lines by"
            >
              {LINE_METRICS.filter(option => metrics.includes(option.id)).map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {uniqueFiles.size > 1 && (
        <div className="file-filter">
          <label htmlFor="hot-line-file-select">File</label>
          <select id="hot-line-file-select" value={selectedFile} onChange={event => onFileChange(event.target.value)}>
            <option value="">All files</option>
            {Array.from(uniqueFiles).sort().map(file => (
              <option key={file} value={file}>{fileName(file)}</option>
            ))}
          </select>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="hotspots-empty">No line has {info.label.toLowerCase()} in this run.</div>
      ) : (
        <div className="hotspots">
          {shown.map(line => {
            const isCurrentFile = uniqueFiles.size <= 1 || (selectedFile && line.file === selectedFile)
            const sourceLine = isCurrentFile ? sourceLines[line.line - 1]?.trim() : null
            const classes = ['hotspot']
            if (comparable && line.isNew) classes.push('hotspot-new')
            else if (comparable && (line.delta ?? 0) > 0) classes.push('hotspot-regression')

            return (
              <div
                key={sourceLineKey(line.file, line.line)}
                className={classes.join(' ')}
                onClick={() => {
                  if (editorRef.current && line.line > 0 && isCurrentFile) {
                    editorRef.current.revealLineInCenter(line.line)
                    editorRef.current.setPosition({ lineNumber: line.line, column: 1 })
                    editorRef.current.focus()
                  }
                }}
              >
                <div className="hotspot-header">
                  <span className="hotspot-location">
                    {line.file ? `${fileName(line.file)}:${line.line}` : `Line ${line.line}`}
                    {comparable && line.isNew && <span className="hotspot-badge new">NEW</span>}
                  </span>
                  <span className="hotspot-stats">
                    {formatMetricCount(line.value, metric)}
                    {comparable && line.delta !== undefined && line.delta !== 0 && (
                      <span className={`hotspot-delta ${line.delta > 0 ? 'negative' : 'positive'}`}>
                        {line.delta > 0 ? '▲' : '▼'} {Math.abs(line.delta).toLocaleString()}
                      </span>
                    )}
                    <span className="hotspot-rate">
                      {metric === 'l1Misses'
                        ? `(${formatPercent(line.missRate)} miss rate)`
                        : `(${formatPercent(line.value / total)} of total)`}
                    </span>
                  </span>
                </div>
                {sourceLine && (
                  <div className="hotspot-code">
                    <code>{sourceLine}</code>
                  </div>
                )}
                <div className="hotspot-bar">
                  <div className="hotspot-bar-fill" style={{ width: `${(line.value / maxValue) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="resolved-section">
          <summary className="resolved-header">
            <span className="resolved-icon">✓</span>
            {resolved.length} resolved hot line{resolved.length !== 1 ? 's' : ''}
          </summary>
          <div className="hotspots resolved">
            {resolved.slice(0, 5).map(line => (
              <div key={sourceLineKey(line.file, line.line)} className="hotspot hotspot-resolved">
                <div className="hotspot-header">
                  <span className="hotspot-location">
                    {line.file ? `${fileName(line.file)}:${line.line}` : `Line ${line.line}`}
                  </span>
                  <span className="hotspot-stats resolved">Was {formatMetricCount(valueOf(line), metric)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
