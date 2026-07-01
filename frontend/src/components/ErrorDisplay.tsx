import { useMemo, useState } from 'react'
import type { ErrorResult } from '../types'
import { formatErrorDiagnostics } from '../utils/errorDiagnostics'

interface ErrorDisplayProps {
  error: ErrorResult
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  const [copied, setCopied] = useState(false)
  const diagnostics = useMemo(() => formatErrorDiagnostics(error), [error])
  const titles: Record<string, string> = {
    compile_error: 'Compilation Failed',
    linker_error: 'Linker Error',
    runtime_error: 'Runtime Error',
    timeout: 'Timeout',
    unknown_error: 'Error',
    validation_error: 'Invalid Request',
    server_error: 'Server Error',
    rate_limit: 'Rate Limited',
  }

  const icons: Record<string, string> = {
    compile_error: '\u2717',
    linker_error: '\u26D4',
    runtime_error: '\u26A0',
    timeout: '\u23F1',
    unknown_error: '\u2753',
    validation_error: '\u26A0',
    server_error: '\u26A0',
    rate_limit: '!',
  }

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="error-box" role="alert" aria-live="assertive">
      <div className="error-header">
        <div className="error-heading">
          <span className="error-icon">{icons[error.type] || '\u2717'}</span>
          <span className="error-title">{titles[error.type] || 'Error'}</span>
          {error.summary && <span className="error-summary">{error.summary}</span>}
        </div>
        <button
          className="error-copy"
          onClick={copyDiagnostics}
          title="Copy diagnostics"
          aria-label="Copy error diagnostics"
        >
          {copied ? 'Copied' : 'Copy Diagnostics'}
        </button>
      </div>

      {error.errors?.map((e, i) => (
        <div key={i} className={`error-item ${e.severity}`}>
          <div className="error-item-header">
            <span className="error-loc">Line {e.line}:{e.column}</span>
            <span className={`error-severity ${e.severity}`}>{e.severity}</span>
          </div>
          <div className="error-msg">{e.message}</div>

          {e.sourceLine && (
            <pre className="error-source">
              <code>{e.sourceLine}</code>
              {e.caret && <code className="error-caret">{e.caret}</code>}
            </pre>
          )}

          {e.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {e.suggestion}
            </div>
          )}

          {e.notes && e.notes.length > 0 && (
            <div className="error-notes">
              {e.notes.map((note, j) => (
                <div key={j} className="error-note">\u2192 {note}</div>
              ))}
            </div>
          )}
        </div>
      ))}

      {error.message && (
        <div className="error-message-box">
          <div className="error-msg">{error.message}</div>
          {error.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {error.suggestion}
            </div>
          )}
          {error.retryAfter && (
            <div className="error-suggestion">
              Retry after {error.retryAfter}s.
            </div>
          )}
        </div>
      )}

      {error.raw && <pre className="error-pre">{error.raw}</pre>}
      {error.error && <pre className="error-pre">{error.error}</pre>}
    </div>
  )
}
