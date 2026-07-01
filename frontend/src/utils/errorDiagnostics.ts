import type { ErrorResult } from '../types'

export function formatErrorDiagnostics(error: ErrorResult) {
  const lines = [
    `type: ${error.type}`,
    error.summary ? `summary: ${error.summary}` : '',
    error.message ? `message: ${error.message}` : '',
    error.suggestion ? `suggestion: ${error.suggestion}` : '',
    error.retryAfter ? `retryAfter: ${error.retryAfter}s` : '',
  ].filter(Boolean)

  for (const item of error.errors || []) {
    lines.push(`line ${item.line}:${item.column} ${item.severity}: ${item.message}`)
    if (item.sourceLine) lines.push(item.sourceLine)
    if (item.caret) lines.push(item.caret)
    if (item.suggestion) lines.push(`hint: ${item.suggestion}`)
    for (const note of item.notes || []) lines.push(`note: ${note}`)
  }

  if (error.raw) lines.push('raw:', error.raw)
  if (error.error) lines.push('error:', error.error)

  return lines.join('\n')
}
