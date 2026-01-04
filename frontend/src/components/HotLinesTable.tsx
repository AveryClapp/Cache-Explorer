import { useMemo } from 'react'
import type { HotLine } from '../types'
import { formatPercent } from '../utils/formatting'

interface HotLinesTableProps {
  hotLines: HotLine[]
  filterByFile?: string  // Empty string or undefined = all files
}

export function HotLinesTable({ hotLines, filterByFile = '' }: HotLinesTableProps) {
  // Group hot lines by file
  const hotLinesByFile = useMemo(() => {
    const groups: Record<string, HotLine[]> = {}
    hotLines.forEach(line => {
      if (!groups[line.file]) {
        groups[line.file] = []
      }
      groups[line.file].push(line)
    })
    // Sort each group by number of misses (descending)
    Object.keys(groups).forEach(file => {
      groups[file].sort((a, b) => b.misses - a.misses)
    })
    return groups
  }, [hotLines])

  // Filter by selected file if specified
  const filesToShow = useMemo(() => {
    if (!filterByFile || filterByFile === '') {
      return hotLinesByFile
    }
    return filterByFile in hotLinesByFile ? { [filterByFile]: hotLinesByFile[filterByFile] } : {}
  }, [hotLinesByFile, filterByFile])

  // Get total stats
  const stats = useMemo(() => {
    let totalHits = 0
    let totalMisses = 0
    Object.values(filesToShow).forEach(lines => {
      lines.forEach(line => {
        totalHits += line.hits
        totalMisses += line.misses
      })
    })
    return { totalHits, totalMisses }
  }, [filesToShow])

  const totalRate = stats.totalHits + stats.totalMisses > 0
    ? stats.totalMisses / (stats.totalHits + stats.totalMisses)
    : 0

  return (
    <div className="hot-lines-container">
      {Object.keys(filesToShow).length === 0 ? (
        <div className="empty-message">No hot lines found</div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="hot-lines-summary">
            <div className="summary-stat">
              <span className="summary-label">Total Hits</span>
              <span className="summary-value">{stats.totalHits.toLocaleString()}</span>
            </div>
            <div className="summary-stat">
              <span className="summary-label">Total Misses</span>
              <span className="summary-value">{stats.totalMisses.toLocaleString()}</span>
            </div>
            <div className="summary-stat">
              <span className="summary-label">Miss Rate</span>
              <span className="summary-value">{formatPercent(totalRate)}</span>
            </div>
          </div>

          {/* File groups */}
          {Object.entries(filesToShow).map(([file, lines]) => (
            <div key={file} className="hot-lines-file-group">
              <div className="file-group-header">
                <h4 className="file-header">{file}</h4>
                <span className="file-badge">{lines.length} lines</span>
              </div>
              <table className="hot-lines-table">
                <thead>
                  <tr>
                    <th className="col-line">Line</th>
                    <th className="col-hits">Hits</th>
                    <th className="col-misses">Misses</th>
                    <th className="col-rate">Miss Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const missRate = line.missRate !== undefined
                      ? line.missRate
                      : line.misses / (line.hits + line.misses)
                    return (
                      <tr key={idx} className="hot-line-row">
                        <td className="col-line">{line.line}</td>
                        <td className="col-hits">{line.hits.toLocaleString()}</td>
                        <td className="col-misses">{line.misses.toLocaleString()}</td>
                        <td className="col-rate">
                          <span className={`miss-rate ${
                            missRate > 0.3 ? 'high' : missRate > 0.1 ? 'medium' : 'low'
                          }`}>
                            {formatPercent(missRate)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
