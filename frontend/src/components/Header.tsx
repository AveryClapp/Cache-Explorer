import type { CacheResult, Stage } from '../types'

interface HeaderProps {
  theme: 'dark' | 'light'
  diffMode: boolean
  baselineResult: CacheResult | null
  result: CacheResult | null
  isLoading: boolean
  stage: Stage
  code: string
  onToggleTheme: () => void
  onSetDiffMode: (mode: boolean) => void
  onSetBaseline: (code: string, result: CacheResult) => void
  onClearBaseline: () => void
  onExportJSON: () => void
  onExportCSV: () => void
  onRun: () => void
  onCancel: () => void
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

export function Header({
  theme,
  diffMode,
  baselineResult,
  result,
  isLoading,
  stage,
  code,
  onToggleTheme,
  onSetDiffMode,
  onSetBaseline,
  onClearBaseline,
  onExportJSON,
  onExportCSV,
  onRun,
  onCancel
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-mark">
            <div className="logo-layer l3"></div>
            <div className="logo-layer l2"></div>
            <div className="logo-layer l1"></div>
          </div>
          <span className="logo-title">Cache Explorer</span>
        </div>
      </div>

      <div className="header-center">
        {diffMode && baselineResult && (
          <div className="diff-mode-badge" title="Comparing against baseline">
            <span className="diff-mode-icon">⇄</span>
            <span className="diff-mode-text">Diff Mode</span>
            <button className="diff-mode-exit" onClick={() => onSetDiffMode(false)} title="Exit diff mode">×</button>
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          className="btn-icon"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        {/* Compare button - visible when result exists */}
        {result && !isLoading && (
          <button
            onClick={() => {
              if (!baselineResult) {
                onSetBaseline(code, result)
              } else if (diffMode) {
                onSetDiffMode(false)
              } else {
                onSetDiffMode(true)
              }
            }}
            className={`btn-compare ${baselineResult ? (diffMode ? 'active' : 'has-baseline') : ''}`}
            title={!baselineResult ? 'Set current result as baseline for comparison' : diffMode ? 'Exit comparison mode' : 'Compare with baseline'}
          >
            {!baselineResult ? 'Set Baseline' : diffMode ? 'Exit Compare' : 'Compare'}
          </button>
        )}
        {baselineResult && !diffMode && (
          <button
            onClick={onClearBaseline}
            className="btn-icon btn-clear-baseline"
            title="Clear baseline"
          >
            ×
          </button>
        )}

        {/* Export dropdown */}
        {result && !isLoading && (
          <div className="export-dropdown">
            <button className="btn-export" title="Export results">
              Export
            </button>
            <div className="export-menu">
              <button onClick={onExportJSON}>JSON</button>
              <button onClick={onExportCSV}>CSV</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <button
            onClick={onCancel}
            className="btn-cancel"
            title="Cancel analysis"
          >
            <span className="btn-spinner" />
            {stageText[stage]}
            <span className="cancel-x">×</span>
          </button>
        ) : (
          <button
            onClick={onRun}
            className="btn-primary"
          >
            Execute
          </button>
        )}
      </div>
    </header>
  )
}
