import type { Stage } from '../types'

interface LoadingStateProps {
  stage: Stage
  longRunning: boolean
}

const stageText: Record<Stage, string> = {
  idle: '',
  connecting: 'Connecting...',
  preparing: 'Preparing...',
  compiling: 'Compiling...',
  running: 'Running...',
  processing: 'Processing...',
  done: ''
}

export function LoadingState({ stage, longRunning }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <div className="loading-text">{stageText[stage]}</div>
      {longRunning && (
        <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--signal-warning)' }}>
          Taking longer than expected. Try enabling sampling in Options.
        </div>
      )}
    </div>
  )
}
