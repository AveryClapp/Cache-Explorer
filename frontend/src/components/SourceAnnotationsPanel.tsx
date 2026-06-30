import type { SourceAnnotation } from '../types'
import { formatPercent } from '../utils/formatting'

interface SourceAnnotationsPanelProps {
  annotations: SourceAnnotation[]
}

function formatLocation(file: string, line: number) {
  const name = file.split('/').pop() || file
  return `${name}:${line}`
}

function formatSubsystem(name: string) {
  return name.replace(/-/g, ' ')
}

export function SourceAnnotationsPanel({ annotations }: SourceAnnotationsPanelProps) {
  const visible = annotations.filter(annotation => annotation.metrics.cycles > 0).slice(0, 8)
  if (visible.length === 0) return null

  return (
    <div className="panel source-annotations-panel">
      <div className="panel-header">
        <span className="panel-title">Source Annotations</span>
        <span className="panel-badge">{visible.length}</span>
      </div>
      <div className="panel-content">
        <div className="source-annotation-list">
          {visible.map(annotation => (
            <div
              className={`source-annotation-row ${annotation.subsystem} ${annotation.severity}`}
              key={`${annotation.subsystem}:${annotation.file}:${annotation.line}`}
            >
              <div className="source-annotation-main">
                <span className="source-annotation-location">
                  {formatLocation(annotation.file, annotation.line)}
                </span>
                <span className={`source-annotation-badge ${annotation.subsystem}`}>
                  {formatSubsystem(annotation.subsystem)}
                </span>
              </div>
              <div className="source-annotation-detail">{annotation.detail}</div>
              <div className="source-annotation-metrics">
                <span>{annotation.metrics.cycles.toLocaleString()} cycles</span>
                <span>{formatPercent(annotation.metrics.share)}</span>
                {annotation.metrics.misses > 0 && <span>{annotation.metrics.misses.toLocaleString()} misses</span>}
                {annotation.metrics.branchMispredictions > 0 && (
                  <span>{annotation.metrics.branchMispredictions.toLocaleString()} mispredicts</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
