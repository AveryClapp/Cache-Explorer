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

function Comparison({ baseline, variant }: { baseline: LabRun; variant: LabRun }) {
  const metrics: [string, keyof Pick<LabRun, 'l1Misses' | 'dtlbMisses' | 'branchMisses' | 'cycles' | 'dramBytes' | 'memoryServiceCycles'>][] = [
    ['L1 data misses', 'l1Misses'], ['Data TLB misses', 'dtlbMisses'], ['Branch mispredictions', 'branchMisses'],
    ['Estimated execution cycles', 'cycles'], ['Demand DRAM fill bytes', 'dramBytes'],
    ['Summed cache/TLB service cycles', 'memoryServiceCycles'],
  ]
  return <>
    <div className="lab-table-scroll"><table className="lab-table">
      <caption>Baseline vs. scenario · negative deltas mean fewer misses, cycles or bytes</caption>
      <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Scenario</th><th scope="col">Delta</th></tr></thead>
      <tbody>{metrics.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{format(baseline[key])}</td><td>{format(variant[key])}</td><td>{delta(baseline[key], variant[key])}</td></tr>)}</tbody>
    </table></div>
    <p className="lab-note">Baseline: {baseline.profile} ({baseline.confidence}). Scenario: {variant.confidence}, uncalibrated. Cycles are analytical estimates, not measured runtime.</p>
    <p className="lab-note">Cache/TLB service cycles sum access costs without overlap; they are not added to execution cycles. The execution model does not currently include page-walk stalls.</p>
    <p className="lab-note">Demand bandwidth pressure: {baseline.bandwidthPressure === null ? 'unavailable' : `${format(baseline.bandwidthPressure * 100)}%`} → {variant.bandwidthPressure === null ? 'unavailable' : `${format(variant.bandwidthPressure * 100)}%`} of the assumed service capacity. This is not measured utilization.</p>
    <h3>Which source lines moved?</h3>
    <p className="lab-note">Bounded source samples. “Not comparable” means a line was absent from one ranked sample, not that it cost zero.</p>
    <div className="lab-source-deltas">{sourceDeltas(baseline, variant).map(({ key, before, after }) => <details key={key}>
      <summary><span>{key}</span><span>L1 misses {delta(before?.misses, after?.misses)} · stall cycles {delta(before?.stallCycles, after?.stallCycles)}</span></summary>
      <p><strong>Baseline:</strong> {before?.explanation || 'No explanation in the saved sample.'}</p>
      <p><strong>Scenario:</strong> {after?.explanation || 'No explanation in the saved sample.'}</p>
    </details>)}</div>
    <details className="lab-report-details"><summary>Configuration, confidence and provenance</summary>
      <p>These results model the captured events. Separate executions can differ because of addresses, input, scheduling or sampling. Replay preserves source and settings, not an identical hardware trace.</p>
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
    onChange(initial.scenario); setError(''); setStatus('Copied the current source and capture settings. No code has run.')
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > MAX_SCENARIO_BYTES) throw new Error('Scenario exceeds the 1 MiB limit.')
      const imported = parseScenario(await file.text())
      onChange(imported); setError(''); setStatus('Imported locally. Saved results are unverified snapshots; review the source before replay. No code has run.')
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
        const data = await response.json()
        if (!response.ok || data.error) throw new Error(data.message || data.error || `Analysis failed (${response.status}).`)
        results.push(projectRun(data as CacheResult))
      }
      if (controller.signal.aborted) return
      onChange({ ...snapshot, report: { generatedAt: new Date().toISOString(), baseline: results[0], variant: results[1] } })
      setStatus('Comparison complete. Export the scenario to keep the source, settings, evidence and results together.')
    } catch (error) {
      setError(controller.signal.aborted ? 'Run cancelled or timed out. No partial comparison is presented.' : (error as Error).message)
      setStatus('')
    } finally { clearTimeout(timeout); setRunning(false); abortRef.current = null }
  }

  return <section className="hardware-lab" aria-labelledby="hardware-lab-title">
    <div className="lab-heading"><div><p className="lab-eyebrow">Hardware Lab · Preview</p><h1 id="hardware-lab-title">Change one assumption. Follow the evidence.</h1>
      <p>Compare the same C/C++ source against a modified CPU model. Local execution only; not a cycle-accurate simulator.</p></div>
      <div className="lab-actions"><button className="btn" disabled={running} onClick={() => fileRef.current?.click()}>Import scenario</button><button className="btn" disabled={!current || running} onClick={exportFile}>Export scenario</button></div>
    </div>
    <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Import Hardware Lab scenario" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
    {error && <p role="alert" className="lab-error">{error}</p>}
    {status && <p role="status" className="lab-status">{status}</p>}
    {hosted && <p className="lab-status">The hosted sandbox does not yet execute Lab scenarios. Import/export and saved report viewing are available; replay requires the local product.</p>}
    {!current ? <div className="lab-card"><p>{initial.error}</p><button className="btn" onClick={onOpenSource}>Open source workspace</button></div> : <div className="lab-layout">
      <aside className="lab-controls" aria-label="Scenario configuration">
        <fieldset className="lab-card" disabled={running}><legend>1. Capture a baseline</legend>
          <label>Scenario name<input value={current.name} maxLength={120} onChange={event => update({ name: event.target.value })} /></label>
          <label>Base hardware profile<select value={current.config} onChange={event => update({ config: event.target.value })}>{HARDWARE_OPTIONS.filter(option => option.value !== 'custom').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <p>{current.files.length} source {current.files.length === 1 ? 'file' : 'files'} · {current.settings.optLevel} · at most {current.settings.limit.toLocaleString()} events · sample 1:{current.settings.sample}</p>
          <p>Segment caching is off. Capture settings are copied from Analyze; the Lab caps runs at 200,000 events.</p>
          <button className="btn" onClick={useCurrentSource}>Use current source &amp; settings</button>
          <details><summary>Review runnable source</summary>{current.files.map(file => <div key={file.name}><h4>{file.name}</h4><pre>{file.code}</pre></div>)}</details>
        </fieldset>
        <fieldset className="lab-card" disabled={running}><legend>2. Change the model</legend>
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
          <p>Unchanged fields inherit the baseline. Geometry must form complete cache/TLB sets. MLP is an explicit independence assumption; prefetch lateness and pollution are unavailable.</p>
        </fieldset>
        {running ? <button className="btn" onClick={() => abortRef.current?.abort()}>Cancel comparison</button> : <button className="btn btn-primary" disabled={hosted} onClick={() => void run()}>Run baseline &amp; scenario</button>}
      </aside>
      <section className="lab-results" aria-label="Scenario evidence"><h2>3. Inspect the difference</h2>
        {current.report ? <><p className="lab-note">Saved report · {current.report.generatedAt}. Imported reports are unverified until replayed.</p><Comparison baseline={current.report.baseline} variant={current.report.variant} /></>
          : <div className="lab-empty"><h3>One baseline, one controlled change</h3><p>Run both models to compare cache misses, translation pressure and estimated execution cost. Source-level evidence will appear here.</p><p>Imports and exports work offline. Running code requires your local compiler and backend. Review imported source before running it.</p></div>}
      </section>
    </div>}
  </section>
}
