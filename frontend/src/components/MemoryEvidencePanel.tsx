import type { CacheResult } from '../types'

const location = (file: string, line: number) => `${file.split(/[/\\]/).pop() || '(unattributed)'}:${line}`

export function MemoryEvidencePanel({ result }: { result: CacheResult }) {
  const memory = result.subsystems?.memorySystem
  const evidence = result.subsystems?.cacheEvidence
  if (!memory && !evidence) return null
  return <section className="panel">
    <div className="panel-header"><h3 className="panel-title">Memory evidence</h3><span className="execution-badge">Modeled / estimated</span></div>
    <div className="panel-content">
      {memory?.available ? <>
        <p>{memory.dramDemandFillBytes?.toLocaleString()} bytes of demand DRAM fills. {memory.pressureAvailable
          ? `Estimated demand pressure: ${((memory.bandwidthPressure || 0) * 100).toFixed(1)}% of the assumed service capacity.`
          : 'Bandwidth pressure unavailable: the trace has no instruction-count basis.'}</p>
        <p>Assumed capacity: {memory.assumedBandwidthBytesPerCycle} bytes/cycle; independent-access overlap: {memory.assumedMlp}. These are analytical assumptions, not measured bandwidth or inferred dependencies.</p>
        {memory.saturationWarning && <p role="status">Demand exceeds the assumed bandwidth capacity. The latency-only cycle estimate is below the demand service floor.</p>}
      </> : <p>{memory?.reason}</p>}
      {evidence?.available ? <>
        <h4>Why did this line miss?</h4>
        <p>{evidence.coverage} Addresses below are cache-line bases ({evidence.lineSize} bytes).</p>
        {evidence.lines?.map(row => <details key={`${row.file}:${row.line}`} className="memory-evidence-row">
          <summary>{location(row.file, row.line)} · {row.misses.toLocaleString()} L1 misses / {row.accesses.toLocaleString()} accesses</summary>
          <p>Observed sample: {row.sample.address}, set {row.sample.set}, tag {row.sample.tag}. Served by {['', 'L1', 'L2', 'L3', 'DRAM'][row.sample.hitLevel]}; {row.sample.missClass}.</p>
          <p>Stride: {row.sample.strideBytes === null ? 'unknown' : `${row.sample.strideBytes} bytes`}. Reuse gap: {row.sample.reuseGapAccesses === null ? 'not in bounded history' : `${row.sample.reuseGapAccesses} intervening accesses`}. Useful hardware prefetch on this access: {row.sample.prefetched ? 'yes' : 'no'}.</p>
          <p>{row.compulsory} compulsory, {row.capacity} capacity-heuristic, {row.conflict} conflict-heuristic, {row.unclassified} unclassified misses. DTLB misses: {row.tlbMisses}.</p>
          {row.sample.competitor && <p>Previously observed in the same set: {row.sample.competitor.address} at {location(row.sample.competitor.file, row.sample.competitor.line)}. This is not proof of eviction causality.</p>}
        </details>)}
        {!!evidence.omittedSourceAccesses && <p>{evidence.omittedSourceAccesses.toLocaleString()} source accesses omitted from the bounded explanation sample.</p>}
        <details><summary>Evidence limits</summary>{[...(memory?.caveats || []), ...(evidence.caveats || [])].map(note => <p key={note}>{note}</p>)}</details>
      </> : <p>{evidence?.reason}</p>}
    </div>
  </section>
}
