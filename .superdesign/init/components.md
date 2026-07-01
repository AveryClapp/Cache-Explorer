# Components

## Framework And UI Stack

- Framework: React 19 + Vite single-page app.
- Component library: custom React components; no shadcn, MUI, Chakra, or Tailwind component layer.
- Styling: imported vanilla CSS under `frontend/src/styles/index.css`.
- Primary route entry: `frontend/src/App.tsx`.

## Shared UI Primitives

### `frontend/src/components/StyledSelect.tsx`

Reusable keyboard-aware select control used by `SettingsToolbar`.

```tsx
import { useState, useRef, useEffect } from 'react'
import type { SelectOption } from '../types'

interface StyledSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}

export function StyledSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
}: StyledSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(o => o.value === value)
  const groups = [...new Set(options.map(o => o.group).filter(Boolean))]
  const hasGroups = groups.length > 0

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      const idx = options.findIndex(o => o.value === value)
      if (idx >= 0) setHighlightedIndex(idx)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, value, options])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => Math.min(prev + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          onChange(options[highlightedIndex].value)
          setIsOpen(false)
        }
        break
    }
  }

  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.styled-select-option')
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, isOpen])

  const renderOptions = () => {
    if (hasGroups) {
      return groups.map(group => (
        <div key={group} className="styled-select-group">
          <div className="styled-select-group-label">{group}</div>
          {options
            .filter(o => o.group === group)
            .map(option => {
              const idx = options.indexOf(option)
              return (
                <div
                  key={option.value}
                  className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
                  onClick={() => { onChange(option.value); setIsOpen(false) }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  {option.value === value && <span className="check-mark">✓</span>}
                  <span className="option-content">
                    <span className="option-label">{option.label}</span>
                    {option.desc && <span className="option-desc">{option.desc}</span>}
                  </span>
                </div>
              )
            })}
        </div>
      ))
    }

    return options.map((option, idx) => (
      <div
        key={option.value}
        className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
        onClick={() => { onChange(option.value); setIsOpen(false) }}
        onMouseEnter={() => setHighlightedIndex(idx)}
      >
        {option.value === value && <span className="check-mark">✓</span>}
        <span className="option-content">
          <span className="option-label">{option.label}</span>
          {option.desc && <span className="option-desc">{option.desc}</span>}
        </span>
      </div>
    ))
  }

  return (
    <div
      ref={containerRef}
      className={`styled-select ${isOpen ? 'open' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="styled-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="styled-select-value">{selectedOption?.label || placeholder}</span>
        <span className="styled-select-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div ref={listRef} className="styled-select-dropdown">
          {renderOptions()}
        </div>
      )}
    </div>
  )
}
```

### `frontend/src/components/EmptyState.tsx`

Main result-panel onboarding component when no result/error/loading state exists.

```tsx
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
        <div className="empty-state-title">Choose a run path</div>
        <div className="empty-state-desc">
          Start with the buffer, a verified workload, a hardware profile, or a variant matrix.
        </div>
        <div className="empty-state-paths">
          <button className="empty-state-path primary" onClick={onRun}>
            <span className="empty-state-path-index">01</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Run buffer</span>
              <span className="empty-state-path-desc">Analyze the active project.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenWorkloads}>
            <span className="empty-state-path-index">02</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Verified workload</span>
              <span className="empty-state-path-desc">Load a snapshot-backed case.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenHardware}>
            <span className="empty-state-path-index">03</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Hardware map</span>
              <span className="empty-state-path-desc">Inspect profiles and run sets.</span>
            </span>
          </button>
          <button className="empty-state-path" onClick={onOpenExperiment}>
            <span className="empty-state-path-index">04</span>
            <span className="empty-state-path-copy">
              <span className="empty-state-path-title">Experiment matrix</span>
              <span className="empty-state-path-desc">Compare variants across hardware.</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
```

## Page-Specific Product Components

- `frontend/src/components/Header.tsx`: app title bar, mode state, primary run actions.
- `frontend/src/components/SettingsToolbar.tsx`: target, compiler, fidelity, defines, and custom cache controls.
- `frontend/src/components/EditorPanel.tsx`: Monaco editor, file tabs, diff editor, status/progress bar.
- `frontend/src/components/ResultsPanel.tsx`: result shell, export/share actions, empty/loading/error/result branches.
- `frontend/src/components/WorkloadCatalogModal.tsx`: verified workload browser with filters, verification state, rows, checks, and load action.
- `frontend/src/components/HardwareExplorerModal.tsx`: hardware profile browser, run-set selection, matrix, exports, and profile detail.
