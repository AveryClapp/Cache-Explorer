import type { AnalysisResult } from '../types'
import './Visualization.css'

interface VisualizationProps {
  result: AnalysisResult | null
}

export default function Visualization({ result }: VisualizationProps) {
  if (!result) {
    return (
      <div className="visualization">
        <div className="placeholder">
          <p>Click "Analyze" to see cache behavior insights</p>
        </div>
      </div>
    )
  }

  return (
    <div className="visualization">
      <div className="metrics">
        <h2>Cache Metrics</h2>
        <div className="metric">
          <span className="metric-label">Estimated Miss Ratio:</span>
          <span className="metric-value">
            {(result.metrics.estimatedMissRatio * 100).toFixed(1)}%
          </span>
        </div>
        {result.metrics.hotFunctions.length > 0 && (
          <div className="metric">
            <span className="metric-label">Hot Functions:</span>
            <ul className="hot-functions">
              {result.metrics.hotFunctions.map((fn, i) => (
                <li key={i}>{fn}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="annotations">
        <h2>Annotations</h2>
        {result.annotations.map((ann, i) => (
          <div key={i} className={`annotation annotation-${ann.severity}`}>
            <div className="annotation-header">
              <span className="annotation-line">Line {ann.line}</span>
              <span className={`annotation-badge ${ann.severity}`}>
                {ann.severity}
              </span>
            </div>
            <p className="annotation-message">{ann.message}</p>
            {ann.suggestion && (
              <p className="annotation-suggestion">💡 {ann.suggestion}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
