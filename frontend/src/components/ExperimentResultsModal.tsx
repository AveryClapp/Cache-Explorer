import { formatPercent } from '../utils/formatting'
import type { HardwareExperimentResult } from '../types'

interface ExperimentResultsModalProps {
  result: HardwareExperimentResult | null
  running: boolean
  error: string | null
  variantsText: string
  hardwareConfigIds: string[]
  onVariantsTextChange: (value: string) => void
  onRun: () => void
  onClose: () => void
}

function formatCycles(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString() : '-'
}

function formatDelta(value: number | null | undefined, percent: number | null | undefined) {
  if (typeof value !== 'number') return '-'
  if (value === 0) return '0'
  const pct = typeof percent === 'number' ? ` (${(percent * 100).toFixed(1)}%)` : ''
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}${pct}`
}

function formatTopSource(row: HardwareExperimentResult['summary'][number]) {
  if (!row.topSource) return '-'
  const file = row.topSource.file.split('/').pop() || row.topSource.file
  return `${file}:${row.topSource.line}`
}

function deltaClass(value: number | null | undefined) {
  if (typeof value !== 'number' || value === 0) return 'neutral'
  return value < 0 ? 'good' : 'warning'
}

function bottleneckClass(value: string) {
  const bottleneck = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  return `bottleneck-chip ${bottleneck}`
}

export function ExperimentResultsModal({
  result,
  running,
  error,
  variantsText,
  hardwareConfigIds,
  onVariantsTextChange,
  onRun,
  onClose,
}: ExperimentResultsModalProps) {
  return (
    <div className="batch-modal-overlay" onClick={() => !running && onClose()}>
      <div className="batch-modal experiment-modal" onClick={event => event.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Hardware Experiment</span>
          <button className="batch-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="batch-modal-content">
          <div className="experiment-controls">
            <label className="experiment-field">
              <span>Variants</span>
              <textarea
                value={variantsText}
                onChange={event => onVariantsTextChange(event.target.value)}
                spellCheck={false}
                rows={3}
              />
            </label>
            <div className="experiment-field experiment-hardware-field">
              <span>Hardware</span>
              <div className="experiment-config-chips">
                {hardwareConfigIds.map(configId => (
                  <span className="experiment-config-chip" key={configId}>{configId}</span>
                ))}
              </div>
            </div>
            <button className="btn-primary experiment-run" onClick={onRun} disabled={running}>
              {running ? 'Running...' : 'Run'}
            </button>
          </div>

          {error && <div className="experiment-error">{error}</div>}

          {running && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              Running experiment...
            </div>
          )}

          {result && result.summary.length > 0 && (
            <table className="batch-results-table experiment-results-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Hardware</th>
                  <th>Bottleneck</th>
                  <th>Cycles</th>
                  <th>Delta</th>
                  <th>L1D Hit</th>
                  <th>Top Source</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.map(row => (
                  <tr key={`${row.variant}-${row.config}`}>
                    <td className="config-name">{row.variant}</td>
                    <td>{row.profile?.displayName || row.config}</td>
                    <td><span className={bottleneckClass(row.primaryBottleneck)}>{row.primaryBottleneck}</span></td>
                    <td>{formatCycles(row.estimatedCycles)}</td>
                    <td className={deltaClass(row.cycleDelta)}>
                      {formatDelta(row.cycleDelta, row.cycleDeltaPercent)}
                    </td>
                    <td>{typeof row.hitRates?.l1d === 'number' ? formatPercent(row.hitRates.l1d) : '-'}</td>
                    <td className="source-cell" title={row.topSource ? `${row.topSource.file}:${row.topSource.line}` : undefined}>
                      {formatTopSource(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
