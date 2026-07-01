interface EmptyStateProps {
  targetSummary: string
  onRun: () => void
  onOpenHardware: () => void
  onOpenWorkloads: () => void
  onOpenExperiment: () => void
}

export function EmptyState({
  targetSummary,
  onRun,
  onOpenHardware,
  onOpenWorkloads,
  onOpenExperiment,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-shell">
        <div className="empty-state-logo">
          <div className="logo-layer l3"></div>
          <div className="logo-layer l2"></div>
          <div className="logo-layer l1"></div>
        </div>
        <div className="empty-state-kicker">Current target</div>
        <div className="empty-state-target">{targetSummary}</div>
        <div className="empty-state-title">Choose a run path</div>
        <div className="empty-state-desc">
          Start with the buffer, a verified workload, a hardware profile, or a variant matrix.
        </div>
        <div className="empty-state-paths">
          <button className="empty-state-path primary" onClick={onRun}>
            <span className="empty-state-path-index">01</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Run buffer</span>
              <span className="empty-state-path-desc">Analyze the active project.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenWorkloads}>
            <span className="empty-state-path-index">02</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Verified workload</span>
              <span className="empty-state-path-desc">Load a snapshot-backed case.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenHardware}>
            <span className="empty-state-path-index">03</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Hardware map</span>
              <span className="empty-state-path-desc">Inspect profiles and run sets.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenExperiment}>
            <span className="empty-state-path-index">04</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Experiment matrix</span>
              <span className="empty-state-path-desc">Compare variants across hardware.</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
