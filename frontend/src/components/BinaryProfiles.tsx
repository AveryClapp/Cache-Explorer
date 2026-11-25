import { useMemo, useRef, useState } from 'react'
import { groupHotspots, importBinaryProfile, MAX_FILE_BYTES, validateBundle } from '../binary/hotspots'
import type { BinaryMetrics, HotspotBundle } from '../binary/hotspots'
import './BinaryProfiles.css'

const number = (value: number) => value.toLocaleString()
export function BinaryProfiles({ bundle, onChange }: { bundle: HotspotBundle | null; onChange: (profile: HotspotBundle | null) => void }) {
  const [imageId, setImageId] = useState(bundle?.codeHotspots[0]?.location.imageId ?? bundle?.images[0].id ?? '')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<keyof BinaryMetrics>('l1dMisses')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const groups = useMemo(() => bundle ? groupHotspots(bundle, imageId, query, sort) : [], [bundle, imageId, query, sort])
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const site of bundle?.codeHotspots ?? []) result.set(site.location.imageId, (result.get(site.location.imageId) ?? 0) + 1)
    return result
  }, [bundle])
  async function openFile(file?: File) {
    if (!file) return
    const id = ++request.current
    setError(''); setBusy(true)
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('File exceeds the 16 MiB import limit.')
      const imported = importBinaryProfile(await file.text())
      if (id !== request.current) return
      onChange(imported)
      setImageId(imported.codeHotspots[0]?.location.imageId ?? imported.images[0].id)
      setQuery('')
    } catch (failure) {
      if (id === request.current) setError(failure instanceof Error ? failure.message : 'Could not read this profile.')
    } finally { if (id === request.current) setBusy(false) }
  }
  function download(selected: boolean) {
    if (!bundle) return
    try {
      const sites = selected ? groups.flatMap(group => group.sites) : bundle.codeHotspots
      const exported = validateBundle({ ...bundle, codeHotspots: sites, coverage: { ...bundle.coverage, returnedSites: sites.length } })
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'hardware-explorer-hotspots-v1.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Export failed.') }
  }
  return <section className="binary-profiles" aria-labelledby="binary-title">
    <div className="binary-heading">
      <div><p className="binary-eyebrow">LOCAL ANALYSIS · PREVIEW</p><h1 id="binary-title">Binary profiles</h1>
        <p>From cache hotspots to the functions behind them.</p></div>
      <label className="binary-file">Open analysis JSON
        <input aria-label="Open binary analysis JSON" type="file" accept=".json,application/json" disabled={busy}
          onChange={event => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
      </label>
    </div>
    <p className="binary-privacy">Files stay in this browser tab. No uploads, source recovery, or program execution.</p>
    {bundle && <button type="button" disabled={busy} onClick={() => { onChange(null); setError('') }}>Close profile</button>}
    {busy && <p role="status">Validating local profile…</p>}
    {error && <p className="binary-error" role="alert">{error} {bundle ? 'The previous profile is still open.' : ''}</p>}
    {!bundle ? <div className="binary-intro">
      <h2>Bring a Windows x86 capture</h2>
      <ol><li>Capture your authorized EXE and DLLs locally with <code>hardware-explore-pin.ps1</code>, or rebuild with clang-cl.</li>
        <li>Analyze the normalized trace using <code>cache-sim --json --config intel</code>. Save the JSON output.</li>
        <li>Optionally add functions with <code>hardware-explore-symbolize.ps1</code>, then open the result here.</li></ol>
      <p>No PDB? You can still export image/RVA hotspots and use the Ghidra adapter to find functions and reconstructed pseudocode.</p>
      <p>Capture runs on Windows. Viewing and export work locally on macOS, Linux, and Windows. Executables and raw traces are not accepted here.</p>
    </div> : <>
      <div className="binary-provenance" aria-label="Capture and model provenance">
        <div><span>CPU model</span><strong>{bundle.profile.displayName}</strong><small>{bundle.profile.modelConfidence} · modeled, not measured</small></div>
        <div><span>Capture</span><strong>{bundle.capture.kind} · x86</strong><small>Sampling 1 in {number(bundle.capture.sampleRate)} · limit {number(bundle.capture.eventLimit)}</small></div>
        <div><span>Coverage</span><strong>{bundle.capture.truncated ? 'Event limit reached' : 'Capture completed'}</strong><small>{number(bundle.codeHotspots.length)} ranked sites · subset only</small></div>
      </div>
      <details className="binary-notes"><summary>Limits, confidence, and sharing privacy</summary>
        <ul>{bundle.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
        <p>Unresolved means no verified function mapping. Source-nearest is an approximate PDB line; decompilers validate the image again. Module/function counts below sum only the exported sites, not the whole program.</p>
        <p>Exports include hashes and module/function names. They exclude raw memory addresses, runtime load addresses, and source paths. Review names before sharing.</p>
        <pre>{JSON.stringify(bundle.profile.configuration, null, 2)}</pre>
      </details>
      <div className="binary-layout">
        <aside aria-label="Captured modules"><h2>Modules <small>{bundle.images.length}</small></h2>
          {bundle.images.map(image => <button key={image.id} type="button" aria-pressed={imageId === image.id}
            onClick={() => { setImageId(image.id); setQuery('') }} title={image.id}>
            <span>{image.name}</span><small>{counts.get(image.id) ?? 0} sites · {image.sha256.slice(0, 8)}</small>
          </button>)}
        </aside>
        <div className="binary-content">
          <div className="binary-filters"><label>Find function or RVA<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Function name or 0x…" /></label>
            <label>Rank by<select value={sort} onChange={event => setSort(event.target.value as keyof BinaryMetrics)}>
              <option value="l1dMisses">L1D misses</option><option value="accesses">Accesses</option><option value="l1dMissRate">Miss rate</option><option value="estimatedMemoryStallCycles">Estimated stall cycles</option>
            </select></label></div>
          <p className="binary-muted">Demand cache-line accesses at exported sites. Counts are not extrapolated.</p>
          {groups.length === 0 && <p role="status">No ranked sites for this module or filter. This does not mean the module has no memory accesses.</p>}
          {groups.map(group => <details className="binary-function" key={`${imageId}:${group.key}`}>
            <summary><span>{group.name}<small>{group.sites.length} sites · {number(group.metrics.accesses)} accesses</small></span>
              <span>{number(group.metrics.l1dMisses)} misses<small>{(group.metrics.l1dMissRate * 100).toFixed(1)}% L1D miss rate</small></span></summary>
            <div className="binary-table-scroll"><table><caption>Instruction sites · {group.name}</caption>
              <thead><tr><th>RVA</th><th>Navigation</th><th>Accesses</th><th>L1D misses</th><th>Miss rate</th><th>Estimated stall cycles</th></tr></thead>
              <tbody>{group.sites.map(site => <tr key={site.location.rva}><td><code>{site.location.rva}</code></td><td>{site.navigationConfidence}</td>
                <td>{number(site.metrics.accesses)}</td><td>{number(site.metrics.l1dMisses)}</td><td>{(site.metrics.l1dMissRate * 100).toFixed(1)}%</td><td>{number(site.metrics.estimatedMemoryStallCycles)}</td></tr>)}</tbody>
            </table></div>
          </details>)}
        </div>
      </div>
      <footer className="binary-export"><div><strong>Continue in your decompiler</strong><p>One identity-checked bundle for Ghidra and the experimental IDA adapter. Includes module and function names.</p></div>
        <button type="button" onClick={() => download(true)} disabled={!groups.length}>Export filtered sites</button>
        <button type="button" className="btn-primary" onClick={() => download(false)}>Export all hotspots</button>
      </footer>
    </>}
  </section>
}
