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
        <div className="empty-state-trust-strip" aria-label="First-run trust summary">
          <div className="empty-state-trust-item">
            <span>First step</span>
            <strong>Run current code</strong>
          </div>
          <div className="empty-state-trust-item">
            <span>Trust packet</span>
            <strong>Compiler / profile / fidelity</strong>
          </div>
          <div className="empty-state-trust-item">
            <span>Hand off</span>
            <strong>Share exact setup</strong>
          </div>
        </div>
        <div className="empty-state-title">Choose a run path</div>
        <div className="empty-state-desc">
          The result includes the hardware contract, caveats, and a local repro command.
        </div>
        <div className="empty-state-evidence" aria-label="Result evidence preview">
          <span>Toolchain</span>
          <span>Model contract</span>
          <span>Repro command</span>
        </div>
        <div className="empty-state-paths">
          <button className="empty-state-path primary" onClick={onRun}>
            <span className="empty-state-path-index">01</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Analyze current code</span>
              <span className="empty-state-path-desc">Run the active source project.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenWorkloads}>
            <span className="empty-state-path-index">02</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Verified workloads</span>
              <span className="empty-state-path-desc">Load a snapshot-backed case.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenHardware}>
            <span className="empty-state-path-index">03</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">CPU profiles</span>
              <span className="empty-state-path-desc">Inspect model coverage and run sets.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenExperiment}>
            <span className="empty-state-path-index">04</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Source experiments</span>
              <span className="empty-state-path-desc">Compare variants across CPU profiles.</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
