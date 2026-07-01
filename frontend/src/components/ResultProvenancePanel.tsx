import { useState } from 'react'
import type { CacheResult } from '../types'
import {
  buildReproCommand,
  formatConfidence,
  formatCompilerLabel,
  formatExecutor,
  formatFidelity,
  formatHardwareLabel,
  formatSimulatorLabel,
  formatSourceLabel,
  formatTrustLabel,
  provenanceClass,
  summarizeModelContract,
} from '../utils/provenance'

interface ResultProvenancePanelProps {
  result: CacheResult
}

export function ResultProvenancePanel({ result }: ResultProvenancePanelProps) {
  const [copiedCommand, setCopiedCommand] = useState(false)
  const provenance = result.provenance
  if (!provenance) return null

  const caveats = provenance.caveats.slice(0, 3)
  const reproCommand = buildReproCommand(result)
  const modelContract = summarizeModelContract(result.profile)

  const copyReproCommand = async () => {
    if (!reproCommand) return
    await navigator.clipboard.writeText(reproCommand)
    setCopiedCommand(true)
    window.setTimeout(() => setCopiedCommand(false), 1600)
  }

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
          <div className="provenance-item">
            <span className="provenance-label">Source</span>
            <span className="provenance-value">{formatSourceLabel(provenance)}</span>
          </div>
          <div className="provenance-item">
            <span className="provenance-label">Compiler</span>
            <span className="provenance-value">{formatCompilerLabel(provenance)}</span>
          </div>
          <div className="provenance-item">
            <span className="provenance-label">Simulator</span>
            <span className="provenance-value">{formatSimulatorLabel(provenance)}</span>
          </div>
        </div>
        {caveats.length > 0 && (
          <div className="provenance-caveats">
            {caveats.map(caveat => (
              <span key={caveat}>{caveat}</span>
            ))}
          </div>
        )}
        {modelContract.length > 0 && (
          <div className="provenance-contract" aria-label="Hardware model contract summary">
            {modelContract.map(bucket => (
              <div
                className={`provenance-contract-bucket ${bucket.key}`}
                key={bucket.key}
                title={bucket.fields.join(', ')}
              >
                <span className="provenance-contract-count">{bucket.count}</span>
                <span className="provenance-contract-copy">
                  <span className="provenance-contract-label">{bucket.label}</span>
                  <span className="provenance-contract-desc">{bucket.description}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {reproCommand && (
          <div className="provenance-repro">
            <div className="provenance-repro-header">
              <span className="provenance-label">Repro Command</span>
              <button type="button" className="provenance-copy" onClick={copyReproCommand}>
                {copiedCommand ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code>{reproCommand}</code>
          </div>
        )}
      </div>
    </div>
  )
}
