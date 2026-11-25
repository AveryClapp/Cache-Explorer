import type { TraceCompleteness } from '../types'

interface TraceCompletenessNoticeProps {
  completeness?: TraceCompleteness
}

/** Warns when the analyzed trace is partial: an abnormal exit or a hit event limit. */
export function TraceCompletenessNotice({ completeness }: TraceCompletenessNoticeProps) {
  if (!completeness) return null
  const abnormalExit = completeness.endMarker === false
  const limitReached = completeness.limitReached === true
  if (!abnormalExit && !limitReached) return null

  return (
    <div className="trace-completeness-notices" role="status">
      {abnormalExit && (
        <div className="trace-completeness-notice warning">
          <span className="trace-completeness-icon" aria-hidden="true">!</span>
          <span>
            The program exited abnormally (crash or signal); results cover only the events traced
            before it stopped.
          </span>
        </div>
      )}
      {limitReached && (
        <div className="trace-completeness-notice info">
          <span className="trace-completeness-icon" aria-hidden="true">i</span>
          <span>
            Event limit reached: analyzed the first {completeness.eventsEmitted.toLocaleString()} of{' '}
            {completeness.eventsObserved.toLocaleString()} events.
          </span>
        </div>
      )}
    </div>
  )
}
