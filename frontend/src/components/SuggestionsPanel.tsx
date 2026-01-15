import type { OptimizationSuggestion } from '../types'

interface SuggestionsPanelProps {
  suggestions: OptimizationSuggestion[]
}

// Strip temp directory paths from locations
const stripTempPath = (path: string) => path.replace(/\/tmp\/cache-explorer-[a-f0-9-]+\//g, '')

export function SuggestionsPanel({ suggestions }: SuggestionsPanelProps) {
  if (!suggestions || suggestions.length === 0) return null

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Optimization Suggestions</span>
        <span className="panel-badge">{suggestions.length}</span>
      </div>
      <div className="suggestions">
        {suggestions.map((s, i) => (
          <div key={i} className={`suggestion ${s.severity}`}>
            <div className="suggestion-header">
              <span className={`suggestion-severity ${s.severity}`}>{s.severity}</span>
              {s.location && <span className="suggestion-location">{stripTempPath(s.location)}</span>}
            </div>
            <div className="suggestion-message">{s.message}</div>
            {s.fix && <div className="suggestion-fix">{s.fix}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
