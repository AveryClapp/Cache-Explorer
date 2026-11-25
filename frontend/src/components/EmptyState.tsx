interface EmptyStateProps {
  targetSummary: string
  onRun: () => void
  onOpenHardware: () => void
  onOpenWorkloads: () => void
  onOpenExperiment: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

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
        <h2 className="empty-state-title">No results yet</h2>
        <p className="empty-state-target">{targetSummary}</p>
        <button className="btn-primary empty-state-run" onClick={onRun}>
          Run analysis
          <kbd>{isMac ? '⌘' : 'Ctrl'} ↵</kbd>
        </button>
        <p className="empty-state-desc">
          You'll get cache misses by source line, the CPU model's assumptions, and a command to
          reproduce the run.
        </p>
        <nav className="empty-state-links" aria-label="Other starting points">
          <button className="empty-state-link" onClick={onOpenWorkloads}>
            <span>Verified workloads</span>
            <span>Known kernels with saved results</span>
          </button>
          <button className="empty-state-link" onClick={onOpenHardware}>
            <span>CPU profiles</span>
            <span>What each model covers</span>
          </button>
          <button className="empty-state-link" onClick={onOpenExperiment}>
            <span>Experiments</span>
            <span>Compare code variants across CPUs</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
