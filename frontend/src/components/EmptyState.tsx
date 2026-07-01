interface EmptyStateProps {
  onRun: () => void
  onOpenWorkloads: () => void
  onOpenExperiment: () => void
}

export function EmptyState({ onRun, onOpenWorkloads, onOpenExperiment }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-logo">
        <div className="logo-layer l3"></div>
        <div className="logo-layer l2"></div>
        <div className="logo-layer l1"></div>
      </div>
      <div className="empty-state-title">Ready to Analyze</div>
      <div className="empty-state-desc">
        Start from the current buffer, a verified workload, or an experiment.
      </div>
      <div className="empty-state-actions">
        <button className="btn-primary empty-state-run" onClick={onRun}>Run</button>
        <button className="btn" onClick={onOpenWorkloads}>Workloads</button>
        <button className="btn" onClick={onOpenExperiment}>Experiment</button>
      </div>
    </div>
  )
}
