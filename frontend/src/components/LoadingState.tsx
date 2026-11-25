import type { Stage } from '../types'
import { STAGE_TEXT } from '../constants'

interface LoadingStateProps {
  stage: Stage
  longRunning: boolean
}

export function LoadingState({ stage, longRunning }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <div className="loading-text">{STAGE_TEXT[stage]}</div>
      {longRunning && (
        <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--signal-warning)' }}>
          Taking longer than expected. Try enabling sampling in Options.
        </div>
      )}
    </div>
  )
}
