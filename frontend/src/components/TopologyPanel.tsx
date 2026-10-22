import type { TopologyEvidence } from '../types'

export function TopologyPanel({ topology }: { topology?: TopologyEvidence }) {
  if (!topology) return null
  return <section className="panel">
    <div className="panel-header"><h3 className="panel-title">Topology &amp; coherence</h3><span className="execution-badge">{topology.available ? 'Modeled' : 'Unavailable'}</span></div>
    <div className="panel-content">
      {!topology.available ? <p>{topology.reason}</p> : <>
        <p>{topology.activeCores} modeled core(s). L1: {topology.l1Scope}; L2: {topology.l2Scope}; L3: {topology.l3Scope}.</p>
        <p>Thread assignment: {topology.threadMapping}.</p>
        <details><summary>Coherence timeline · {topology.observedEvents || 0} observed cross-core events</summary>
          {topology.events?.length ? <ol className="coherence-timeline">{topology.events.map(event => <li key={event.sequence}>
            #{event.sequence} · Core {event.sourceCore} → core {event.targetCore} · {event.type} · <code>{event.address}</code>
          </li>)}</ol> : <p>No cross-core snoops observed in this run. This is not proof that the program is free of contention.</p>}
          {!!topology.omittedEvents && <p>{topology.omittedEvents} earlier events omitted; only the latest 256 are retained.</p>}
        </details>
        <details><summary>Topology limits</summary>{topology.caveats?.map(note => <p key={note}>{note}</p>)}</details>
      </>}
    </div>
  </section>
}
