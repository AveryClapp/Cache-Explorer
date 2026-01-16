import { formatPercent } from '../utils/formatting'
import type { HotLine } from '../types'
import type { editor } from 'monaco-editor'

interface HotLinesPanelProps {
  hotLines: HotLine[]
  code: string
  selectedFile: string
  onFileChange: (file: string) => void
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
}

export function HotLinesPanel({ hotLines, code, selectedFile, onFileChange, editorRef }: HotLinesPanelProps) {
  // Filter hotlines to only show those with more than 1 total access
  const significantHotLines = hotLines.filter(h => (h.hits + h.misses) > 1)

  if (significantHotLines.length === 0) return null

  const filteredLines = significantHotLines.filter(h => !selectedFile || h.file === selectedFile)
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

          return (
            <div
              key={i}
              className="hotspot"
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
                </span>
                <span className="hotspot-stats">
                  {hotLine.misses.toLocaleString()} misses ({formatPercent(hotLine.missRate)})
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
    </div>
  )
}
