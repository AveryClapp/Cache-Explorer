import type { CacheResult } from '../types'
import {
  formatConfidence,
  formatExecutor,
  formatFidelity,
  formatHardwareLabel,
  formatTrustLabel,
  provenanceClass,
} from '../utils/provenance'

interface ResultProvenancePanelProps {
  result: CacheResult
}

export function ResultProvenancePanel({ result }: ResultProvenancePanelProps) {
  const provenance = result.provenance
  if (!provenance) return null

  const caveats = provenance.caveats.slice(0, 3)

  return (
    <div className="panel result-provenance-panel">
      <div className="panel-header">
        <span className="panel-title">Result Fidelity</span>
        <span className={`provenance-chip ${provenanceClass(provenance)}`}>
          {formatTrustLabel(provenance)}
        </span>
      </div>
      <div className="panel-content">
        <div className="provenance-grid">
          <div className="provenance-item">
            <span className="provenance-label">Hardware</span>
            <span className="provenance-value">{formatHardwareLabel(provenance)}</span>
          </div>
          <div className="provenance-item">
            <span className="provenance-label">Trace</span>
            <span className="provenance-value">{formatFidelity(provenance)}</span>
          </div>
          <div className="provenance-item">
            <span className="provenance-label">Confidence</span>
            <span className="provenance-value">{formatConfidence(provenance)}</span>
          </div>
          <div className="provenance-item">
            <span className="provenance-label">Executor</span>
            <span className="provenance-value">
              {formatExecutor(provenance)}
              {provenance.cached ? ' / cached' : ''}
            </span>
          </div>
        </div>
        {caveats.length > 0 && (
          <div className="provenance-caveats">
            {caveats.map(caveat => (
              <span key={caveat}>{caveat}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
