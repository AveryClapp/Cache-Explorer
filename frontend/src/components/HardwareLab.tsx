import { useEffect, useMemo, useRef, useState } from 'react'
import type { CacheResult, FileTab } from '../types'
import { API_BASE } from '../constants/config'
import { HARDWARE_OPTIONS } from '../constants/options'
import { captureScenario, fields, MAX_SCENARIO_BYTES, parseScenario, projectRun, sourceDeltas, validateOverrides } from '../lab/scenario'
import type { LabRun, LabScenario } from '../lab/scenario'
import './HardwareLab.css'

interface Props {
  files: FileTab[]; config: string; payload: Record<string, unknown>
  scenario: LabScenario | null; onChange: (scenario: LabScenario) => void
  onOpenSource: () => void
  hosted: boolean
}
const presets = [
  { name: '64 KiB L1', overrides: { 'l1d.sizeKB': '64' } },
  { name: 'Stride prefetch', overrides: { 'prefetch.policy': 'stride' } },
  { name: 'Huge pages', overrides: { 'tlb.pageSize': '2097152' } },
  { name: 'Gshare predictor', overrides: { 'branch.predictor': 'gshare' } },
  { name: '100-cycle DRAM', overrides: { 'memory.dramCycles': '100' } },
  { name: 'More independent misses', overrides: { 'memory.assumedMlp': '4' } },
] as const
const format = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
const delta = (before: number | null | undefined, after: number | null | undefined) => before == null || after == null ? 'Not comparable' : `${after - before > 0 ? '+' : ''}${format(after - before)}`

type Metric = keyof Pick<LabRun, 'l1Misses' | 'dtlbMisses' | 'branchMisses' | 'cycles' | 'dramBytes' | 'memoryServiceCycles'>
const metrics: [string, Metric][] = [
  ['L1 data misses', 'l1Misses'], ['Data TLB misses', 'dtlbMisses'], ['Branch mispredictions', 'branchMisses'],
  ['Estimated execution cycles', 'cycles'], ['Demand DRAM fill bytes', 'dramBytes'],
  ['Summed cache/TLB service cycles', 'memoryServiceCycles'],
]

// Every metric here is a cost, so a decrease is an improvement.
function Change({ before, after }: { before: number | null | undefined; after: number | null | undefined }) {
  if (before == null || after == null) return <td className="lab-change">Not comparable</td>
  const diff = after - before
  if (diff === 0) return <td className="lab-change same">No change</td>
  const pct = before === 0 ? '' : ` (${diff > 0 ? '+' : ''}${(diff / before * 100).toFixed(1)}%)`
  return <td className={`lab-change ${diff < 0 ? 'better' : 'worse'}`}>{diff > 0 ? '+' : ''}{format(diff)}{pct}</td>
}

const pressure = (value: number | null) => value === null ? 'Unavailable' : `${format(value * 100)}%`
const percent = (value: number | null) => value === null ? null : Math.round(value * 100000) / 1000

function Comparison({ baseline, variant }: { baseline: LabRun; variant: LabRun }) {
  const lines = sourceDeltas(baseline, variant)
  const moved = lines.filter(({ before, after }) => !before || !after || before.misses !== after.misses || before.stallCycles !== after.stallCycles)
  const unchanged = lines.length - moved.length
  return <>
    <div className="lab-table-scroll"><table className="lab-table">
      <caption>Lower is better for every row.</caption>
      <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Scenario</th><th scope="col">Change</th></tr></thead>
      <tbody>
        {metrics.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{format(baseline[key])}</td><td>{format(variant[key])}</td><Change before={baseline[key]} after={variant[key]} /></tr>)}
        <tr><th scope="row">Demand bandwidth pressure</th><td>{pressure(baseline.bandwidthPressure)}</td><td>{pressure(variant.bandwidthPressure)}</td><Change before={percent(baseline.bandwidthPressure)} after={percent(variant.bandwidthPressure)} /></tr>
      </tbody>
    </table></div>
    <p className="lab-note">The scenario is uncalibrated, and cycles are analytical estimates rather than measured runtime. Details are under "Configuration and caveats".</p>
    <h3>Source lines that changed</h3>
    {moved.length === 0 ? <p className="lab-note">No sampled source line changed.</p> : <div className="lab-source-deltas">{moved.map(({ key, before, after }) => <details key={key}>
      <summary><span>{key}</span><span>L1 misses {delta(before?.misses, after?.misses)} · stall cycles {delta(before?.stallCycles, after?.stallCycles)}</span></summary>
      <p><strong>Baseline:</strong> {before?.explanation || 'No explanation in the saved sample.'}</p>
      <p><strong>Scenario:</strong> {after?.explanation || 'No explanation in the saved sample.'}</p>
    </details>)}</div>}
    {unchanged > 0 && <p className="lab-note">{unchanged} other sampled {unchanged === 1 ? 'line' : 'lines'} unchanged. Lines are a bounded sample; "Not comparable" means a line appeared in only one run's sample.</p>}
    <details className="lab-report-details"><summary>Configuration and caveats</summary>
      <p>Baseline: {baseline.profile} ({baseline.confidence}). Scenario: {variant.confidence}, uncalibrated.</p>
      <p>Cache/TLB service cycles sum access costs without overlap and are not added to execution cycles; the execution model does not include page-walk stalls. Bandwidth pressure is demand fill bytes against the assumed service capacity, not measured utilization.</p>
      <p>Separate executions can differ in addresses, input, scheduling or sampling. Replay preserves source and settings, not an identical trace.</p>
      {[...new Set([...baseline.caveats, ...variant.caveats])].map(note => <p key={note}>{note}</p>)}
      <div className="lab-table-scroll"><table className="lab-table"><caption>Effective scenario configuration</caption><tbody>{Object.entries(variant.configuration).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>)}</tbody></table></div>
      <pre>{JSON.stringify({ baseline: baseline.provenance, scenario: variant.provenance }, null, 2)}</pre>
    </details>
  </>
}

export function HardwareLab({ files, config, payload, scenario, onChange, onOpenSource, hosted }: Props) {
  const initial = useMemo(() => {
    try { return { scenario: captureScenario(files, config, payload), error: '' } }
    catch (error) { return { scenario: null, error: (error as Error).message } }
  }, [files, config, payload])
  const current = scenario || initial.scenario
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const [fieldToAdd, setFieldToAdd] = useState(fields[0].key)
  const abortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const update = (patch: Partial<LabScenario>) => {
    if (current) onChange({ ...current, ...patch, report: undefined })
    setError(''); setStatus('')
  }
  const useCurrentSource = () => {
    if (!initial.scenario) { setError(initial.error); return }
    onChange(initial.scenario); setError(''); setStatus('Copied the current source and settings. Nothing has run yet.')
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > MAX_SCENARIO_BYTES) throw new Error('Scenario exceeds the 1 MiB limit.')
      const imported = parseScenario(await file.text())
      onChange(imported); setError(''); setStatus('Imported locally. Nothing has run; review the source before running it. Saved results are an unverified snapshot.')
    } catch (error) { setError((error as Error).message) }
  }
  const exportFile = () => {
    if (!current) return
    try {
      const exported = parseScenario(JSON.stringify(current))
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'hardware-explorer-scenario.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError('')
    } catch (error) { setError((error as Error).message) }
  }
  const run = async () => {
    if (!current || running || hosted) return
    let snapshot: LabScenario
    try {
      snapshot = parseScenario(JSON.stringify(current))
      snapshot.overrides = validateOverrides(snapshot.overrides)
      if (!Object.keys(snapshot.overrides).length) throw new Error('Add a parameter to compare with the baseline.')
    } catch (error) { setError((error as Error).message); return }
    const controller = new AbortController(); abortRef.current = controller
    setRunning(true); setError(''); onChange({ ...snapshot, report: undefined })
    const timeout = setTimeout(() => controller.abort(), 180000)
    try {
      const results: LabRun[] = []
      for (const [index, hardwareLab] of [{}, snapshot.overrides].entries()) {
        setStatus(index === 0 ? 'Running baseline (1 of 2)…' : 'Running scenario (2 of 2)…')
        const response = await fetch(`${API_BASE}/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ ...snapshot.settings, files: snapshot.files, language: snapshot.files[0].language, config: snapshot.config, hardwareLab, cacheSegments: false, timeout: 60000 }) })
        // A proxy or crashed backend can answer with HTML; report the status, not a JSON parse error.
        const data = await response.json().catch(() => ({ error: `Analysis failed (${response.status}); the backend did not return JSON.` }))
        if (!response.ok || data.error) throw new Error(data.message || data.error || `Analysis failed (${response.status}).`)
        results.push(projectRun(data as CacheResult))
      }
      if (controller.signal.aborted) return
      onChange({ ...snapshot, report: { generatedAt: new Date().toISOString(), baseline: results[0], variant: results[1] } })
      setStatus('Comparison complete. Export the scenario to keep it.')
    } catch (error) {
      setError(controller.signal.aborted ? 'Run cancelled or timed out. No partial comparison is presented.' : (error as Error).message)
      setStatus('')
    } finally { clearTimeout(timeout); setRunning(false); abortRef.current = null }
  }

  return <section className="hardware-lab" aria-labelledby="hardware-lab-title">
    <div className="lab-heading"><div><h1 id="hardware-lab-title">Hardware Lab</h1>
      <p>Run the same C/C++ code on a CPU profile and on a modified copy of it, then compare. Runs locally; estimates, not cycle-accurate.</p></div>
      <div className="lab-actions"><button className="btn" disabled={running} onClick={() => fileRef.current?.click()}>Import scenario</button><button className="btn" disabled={!current || running} onClick={exportFile}>Export scenario</button></div>
    </div>
    <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Import Hardware Lab scenario" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
    {error && <p role="alert" className="lab-error">{error}</p>}
    {status && <p role="status" className="lab-status">{status}</p>}
    {hosted && <p className="lab-status">This server can't run Lab scenarios yet. You can still import, export and view saved reports; running them needs a local install.</p>}
    {!current ? <div className="lab-card"><p>{initial.error}</p><button className="btn" onClick={onOpenSource}>Open source workspace</button></div> : <div className="lab-layout">
      <aside className="lab-controls" aria-label="Scenario configuration">
        <fieldset className="lab-card" disabled={running}><legend>Baseline</legend>
          <label>Name<input value={current.name} maxLength={120} onChange={event => update({ name: event.target.value })} /></label>
          <label>CPU profile<select value={current.config} onChange={event => update({ config: event.target.value })}>{HARDWARE_OPTIONS.filter(option => option.value !== 'custom').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <p>{current.files.length} source {current.files.length === 1 ? 'file' : 'files'} from Analyze · {current.settings.optLevel} · up to {current.settings.limit.toLocaleString()} events · sample 1:{current.settings.sample}</p>
          <button className="btn" onClick={useCurrentSource}>Reload from Analyze</button>
          <details><summary>View source</summary>{current.files.map(file => <div key={file.name}><h4>{file.name}</h4><pre>{file.code}</pre></div>)}</details>
        </fieldset>
        <fieldset className="lab-card" disabled={running}><legend>Changes</legend>
          <div className="lab-presets">{presets.map(preset => <button className="btn btn-small" key={preset.name} onClick={() => update({ overrides: { ...preset.overrides } })}>{preset.name}</button>)}</div>
          {Object.entries(current.overrides).map(([key, value]) => {
            const field = fields.find(field => field.key === key)!
            return <div className="lab-override" key={key}><label>{field.label}{field.values
              ? <select value={value} onChange={event => update({ overrides: { ...current.overrides, [key]: event.target.value } })}>{field.values.map(value => <option key={value}>{value}</option>)}</select>
              : <input type="number" min={field.min} max={field.max} step={1} value={value} onChange={event => update({ overrides: { ...current.overrides, [key]: event.target.value } })} />}</label>
              <button className="btn-icon" aria-label={`Remove ${field.label}`} onClick={() => update({ overrides: Object.fromEntries(Object.entries(current.overrides).filter(([entry]) => entry !== key)) })}>×</button></div>
          })}
          <label>Add a parameter<select value={fieldToAdd} onChange={event => setFieldToAdd(event.target.value)}>{fields.map(field => <option key={field.key} value={field.key}>{field.group} · {field.label}</option>)}</select></label>
          <button className="btn btn-small" disabled={fieldToAdd in current.overrides} onClick={() => update({ overrides: { ...current.overrides, [fieldToAdd]: fields.find(field => field.key === fieldToAdd)!.initial } })}>Add parameter</button>
          <p>Anything you don't change keeps the baseline value.</p>
        </fieldset>
        <div className="lab-run">{running ? <button className="btn" onClick={() => abortRef.current?.abort()}>Cancel comparison</button> : <button className="btn btn-primary" disabled={hosted} onClick={() => void run()}>Run baseline &amp; scenario</button>}</div>
      </aside>
      <section className="lab-results" aria-label="Scenario evidence"><h2>Results</h2>
        {current.report ? <><p className="lab-note">Run <time dateTime={current.report.generatedAt}>{new Date(current.report.generatedAt).toLocaleString()}</time></p><Comparison baseline={current.report.baseline} variant={current.report.variant} /></>
          : <div className="lab-empty"><p>Pick a change, then run. You'll see how cache misses, TLB misses and estimated cycles move, and which source lines changed.</p></div>}
      </section>
    </div>}
  </section>
}
