import { formatPercent } from '../utils/formatting'
import { formatTrustLabel, provenanceClass } from '../utils/provenance'
import type { ExperimentTemplate } from '../constants'
import type { CacheResult, HardwareExperimentResult } from '../types'

interface ExperimentResultsModalProps {
  result: HardwareExperimentResult | null
  running: boolean
  error: string | null
  variantsText: string
  variantSourceLabel?: string | null
  hardwareConfigIds: string[]
  templates: ExperimentTemplate[]
  selectedTemplateId: string
  templatePending: boolean
  onVariantsTextChange: (value: string) => void
  onTemplateChange: (value: string) => void
  onApplyTemplate: () => void
  onRun: () => void
  onExportCSV?: () => void
  onExportJSON?: () => void
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

function resultForSummaryRow(result: HardwareExperimentResult, row: HardwareExperimentResult['summary'][number]): CacheResult | undefined {
  return result.variants[row.variant]?.configs[row.config]
}

function winnerRows(result: HardwareExperimentResult | null) {
  if (!result) return []
  const winners = new Map<string, HardwareExperimentResult['summary'][number]>()
  for (const row of result.summary) {
    const current = winners.get(row.config)
    if (!current || row.estimatedCycles < current.estimatedCycles) {
      winners.set(row.config, row)
    }
  }
  return Array.from(winners.values())
}

function overallWinner(result: HardwareExperimentResult | null) {
  if (!result) return null
  const totals = new Map<string, { variant: string; cycles: number; rows: number }>()
  for (const row of result.summary) {
    const current = totals.get(row.variant) || { variant: row.variant, cycles: 0, rows: 0 }
    current.cycles += row.estimatedCycles
    current.rows += 1
    totals.set(row.variant, current)
  }
  return Array.from(totals.values()).sort((a, b) => a.cycles - b.cycles)[0] || null
}

export function ExperimentResultsModal({
  result,
  running,
  error,
  variantsText,
  variantSourceLabel,
  hardwareConfigIds,
  templates,
  selectedTemplateId,
  templatePending,
  onVariantsTextChange,
  onTemplateChange,
  onApplyTemplate,
  onRun,
  onExportCSV,
  onExportJSON,
  onClose,
}: ExperimentResultsModalProps) {
  const winners = winnerRows(result)
  const overall = overallWinner(result)
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId)

  return (
    <div className="batch-modal-overlay product-surface-overlay" onClick={() => !running && onClose()}>
      <div
        className="batch-modal experiment-modal product-surface-panel"
        onClick={event => event.stopPropagation()}
        role="region"
        aria-labelledby="hardware-experiment-title"
      >
        <div className="batch-modal-header">
          <span className="batch-modal-title" id="hardware-experiment-title">Hardware Experiment</span>
          <div className="batch-modal-header-actions">
            {onExportCSV && (
              <button className="btn" onClick={onExportCSV} disabled={!result}>
                Export CSV
              </button>
            )}
            {onExportJSON && (
              <button className="btn" onClick={onExportJSON} disabled={!result}>
                Export JSON
              </button>
            )}
            <button className="batch-modal-close surface-back" onClick={onClose} aria-label="Close hardware experiment and return to analysis">Back to Analyze</button>
          </div>
        </div>
        <div className="batch-modal-content">
          {templates.length > 0 && (
            <div className="experiment-template-bar">
              <label className="experiment-field experiment-template-field">
                <span>Template</span>
                <select
                  value={selectedTemplateId}
                  onChange={event => onTemplateChange(event.target.value)}
                  aria-label="Experiment template"
                >
                  {templates.map(template => (
                    <option value={template.id} key={template.id}>{template.name}</option>
                  ))}
                </select>
              </label>
              <div className="experiment-template-desc">
                {selectedTemplate?.description || ''}
                {selectedTemplate?.verifiedWorkloadId && (
                  <span className="experiment-template-verified">
                    Workload fixture {selectedTemplate.verifiedWorkloadId}
                  </span>
                )}
              </div>
              <button className="btn experiment-template-apply" onClick={onApplyTemplate} disabled={running || !selectedTemplate}>
                {templatePending ? 'Apply' : 'Applied'}
              </button>
            </div>
          )}

          <div className="experiment-controls">
            <label className="experiment-field">
              <span className="experiment-field-heading">
                <span>Variants</span>
                {variantSourceLabel && <span className="experiment-source-chip">{variantSourceLabel}</span>}
              </span>
              <textarea
                value={variantsText}
                onChange={event => onVariantsTextChange(event.target.value)}
                spellCheck={false}
                rows={3}
                aria-label="Experiment variants"
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
            <button className="btn-primary experiment-run" onClick={onRun} disabled={running || templatePending}>
              {running ? 'Running...' : 'Run'}
            </button>
          </div>

          {templatePending && (
            <div className="experiment-setup-notice" role="status">
              Apply this template to load its matching source and run settings before running the experiment.
            </div>
          )}

          {error && <div className="experiment-error" role="alert">{error}</div>}

          {running && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              Running experiment...
            </div>
          )}

          {overall && (
            <div className="experiment-overall-winner">
              <span className="experiment-overall-label">Overall</span>
              <span className="experiment-overall-variant">{overall.variant}</span>
              <span className="experiment-overall-cycles">{formatCycles(overall.cycles)} cycles</span>
            </div>
          )}

          {winners.length > 0 && (
            <div className="experiment-winners">
              {winners.map(row => (
                <div className="experiment-winner-row" key={row.config}>
                  <span className="experiment-winner-hardware">{row.profile?.displayName || row.config}</span>
                  <span className="experiment-winner-variant">{row.variant}</span>
                  <span className={deltaClass(row.cycleDelta)}>
                    {formatDelta(row.cycleDelta, row.cycleDeltaPercent)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {result && result.summary.length > 0 && (
            <table className="batch-results-table experiment-results-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Hardware</th>
                  <th>Trust</th>
                  <th>Bottleneck</th>
                  <th>Cycles</th>
                  <th>Delta</th>
                  <th>L1D Hit</th>
                  <th>Top Source</th>
                </tr>
              </thead>
              <tbody>
                {result.summary.map(row => {
                  const rowResult = resultForSummaryRow(result, row)
                  return (
                    <tr key={`${row.variant}-${row.config}`}>
                      <td className="config-name">{row.variant}</td>
                      <td>{row.profile?.displayName || row.config}</td>
                      <td>
                        <span className={`provenance-inline ${provenanceClass(rowResult?.provenance)}`}>
                          {formatTrustLabel(rowResult?.provenance)}
                        </span>
                      </td>
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
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
