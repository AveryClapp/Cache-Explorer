# App.tsx Refactoring: Modular Architecture

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break down the 3,523-line monolithic App.tsx into modular, maintainable components with clear separation of concerns and reusable state management hooks.

**Architecture:** Extract App.tsx into feature-based components and custom hooks:
- **Custom Hooks** (`hooks/`) - Business logic (state management, API calls, keyboard shortcuts, theme, WebSocket)
- **UI Components** (`components/`) - Presentational components (results panels, visualizations, modals)
- **Utils** (`utils/`) - Helpers, constants, types
- **Keep App.tsx** (~300 LOC) - Thin orchestrator composing hooks and components

**Tech Stack:** React 19, TypeScript, existing Monaco Editor, WebSocket, existing HTTP API

---

## Architecture Layers

### 1. Custom Hooks (New)
- `useAnalysisState()` - File management, code state
- `useConfigState()` - Hardware config, optimization level, prefetch policy
- `useAnalysisExecution()` - Running analysis, WebSocket streaming, stage management
- `useEditorState()` - Editor refs, decorations, Vim mode, error markers
- `useTheme()` - Dark/light mode persistence
- `useKeyboardShortcuts()` - Cmd+K, Cmd+Enter, Escape handling
- `useUrlState()` - Hash-based state persistence, URL shortening
- `useMobileResponsive()` - Mobile detection and pane switching
- `useCompilerDiscovery()` - Fetch and manage available compilers

### 2. Presentational Components (Extracted)
- `ResultsPanel.tsx` - All result display (cache hierarchy, stats, hot lines, false sharing, suggestions)
- `CacheHierarchyDisplay.tsx` - Visual cache hierarchy
- `StatsTable.tsx` - Generic stats rendering
- `HotLinesTable.tsx` - Sortable hot lines with source navigation
- `FalseSharingTable.tsx` - False sharing details
- `OptimizationSuggestionsPanel.tsx` - Suggestions with severity
- `TimelineControl.tsx` - Timeline scrubber and event display
- `ErrorPanel.tsx` - Error display (already mostly extracted)
- `CommandPalette.tsx` - Already exists but can move to components/
- `QuickConfigPanel.tsx` - Already exists but can move to components/
- `AdvancedOptionsModal.tsx` - Extract from App inline JSX

### 3. Feature Components (Already Extracted)
- `FileManager.tsx` - File management UI
- `MemoryLayout.tsx` - Memory visualization
- `CacheGrid.tsx` - Interactive cache grid

### 4. Types & Constants (New)
- `types/index.ts` - All interfaces (Compiler, CacheStats, etc.)
- `constants/config.ts` - Hardware presets, prefetch defaults, optimization level strings
- `constants/examples.ts` - Move EXAMPLES object here
- `constants/api.ts` - API_BASE, WS_URL

### 5. Utils (New)
- `utils/state.ts` - encodeState, decodeState, ShareableState
- `utils/formatting.ts` - formatPercent, other formatting helpers
- `utils/file.ts` - generateFileId, getFileExtension, createFileTab
- `utils/compiler-explorer.ts` - openInCompilerExplorer logic
- `utils/performance.ts` - Hit rate classification logic

---

## Implementation Tasks

### Task 1: Create directory structure and move types

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/hooks/index.ts`
- Create: `frontend/src/utils/state.ts`
- Create: `frontend/src/utils/formatting.ts`
- Create: `frontend/src/utils/file.ts`
- Modify: `frontend/src/App.tsx` (extract types)

**Step 1: Create types file with all interfaces**

Create `/frontend/src/types/index.ts`:

```typescript
// Compiler configuration
export interface Compiler {
  id: string
  name: string
  version: string
  major: number
  path: string
  source: string
  default?: boolean
}

// Cache statistics
export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

export interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

export interface TLBHierarchyStats {
  dtlb: TLBStats
  itlb: TLBStats
}

// Analysis results
export interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
  threads?: number
}

export interface FalseSharingAccess {
  threadId: number
  offset: number
  isWrite: boolean
  file: string
  line: number
  count: number
}

export interface FalseSharingEvent {
  cacheLineAddr: string
  accessCount: number
  accesses: FalseSharingAccess[]
}

export interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

export interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

export interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
}

// Error handling
export interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
  notes?: string[]
  sourceLine?: string
  caret?: string
}

export type ErrorType = 'compile_error' | 'linker_error' | 'runtime_error' | 'timeout' | 'unknown_error' | 'validation_error' | 'server_error'

export interface ErrorResult {
  type: ErrorType
  errors?: CompileError[]
  summary?: string
  message?: string
  suggestion?: string
  raw?: string
  error?: string
}

// Cache configuration
export interface CacheLevelConfig {
  size: number
  associativity: number
  lineSize: number
  writePolicy: string
}

export interface CacheConfig {
  l1: CacheLevelConfig
  l2: CacheLevelConfig
  l3: CacheLevelConfig
}

// Timeline
export interface TimelineEvent {
  addr: string
  type: 'L' | 'S'
  size: number
  n: number
}

// Cache state for visualization
export interface CacheLineState {
  address: string
  valid: boolean
  dirty: boolean
  tag: string
}

export interface CoreCacheState {
  coreId: number
  lines: CacheLineState[]
}

export interface CacheState {
  cores: CoreCacheState[]
  timestamp: number
}

// API Response
export interface CacheResult {
  config: string
  events: number
  multicore: boolean
  cores: number
  levels: Record<string, CacheStats>
  tlb?: TLBHierarchyStats
  coherence?: CoherenceStats
  hotLines: HotLine[]
  falseSharing: FalseSharingEvent[]
  suggestions: OptimizationSuggestion[]
  prefetch?: PrefetchStats
  timeline?: TimelineEvent[]
}

// File management
export type Language = 'c' | 'cpp' | 'rust'

export interface FileTab {
  id: string
  name: string
  code: string
  language: Language
}

// Example code
export interface Example {
  name: string
  description: string
  language: Language
  code: string
}

// Configuration
export interface DefineEntry {
  name: string
  value: string
}

export interface CustomCacheConfig {
  lineSize: number
  l1Size: number
  l1Assoc: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

export interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

// Stage management
export type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

export type PrefetchPolicy = 'none' | 'next' | 'stream' | 'stride' | 'adaptive'

export type Theme = 'dark' | 'light'
```

**Step 2: Run type checking to ensure App.tsx still compiles**

Run: `cd frontend && npm run build 2>&1 | grep -A 5 "error TS"` (should show no errors initially since we haven't deleted from App yet)

Expected: No errors (we're just creating new files)

**Step 3: Create state utilities**

Create `/frontend/src/utils/state.ts`:

```typescript
import LZString from 'lz-string'
import type { ShareableState } from '../types'

export function encodeState(state: ShareableState): string {
  try {
    return LZString.compressToEncodedURIComponent(JSON.stringify(state))
  } catch {
    return ''
  }
}

export function decodeState(encoded: string): ShareableState | null {
  try {
    const decoded = LZString.decompressFromEncodedURIComponent(encoded)
    if (!decoded) return null
    return JSON.parse(decoded)
  } catch {
    return null
  }
}
```

**Step 4: Create formatting utilities**

Create `/frontend/src/utils/formatting.ts`:

```typescript
export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export function getRateClass(rate: number): string {
  return rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'
}
```

**Step 5: Create file utilities**

Create `/frontend/src/utils/file.ts`:

```typescript
import type { Language, FileTab } from '../types'

let fileIdCounter = 0

export function generateFileId(): string {
  return `file_${++fileIdCounter}_${Date.now()}`
}

export function getFileExtension(lang: Language): string {
  switch (lang) {
    case 'cpp': return '.cpp'
    case 'rust': return '.rs'
    default: return '.c'
  }
}

export function createFileTab(name: string, code: string, language: Language): FileTab {
  return { id: generateFileId(), name, code, language }
}
```

**Step 6: Create constants file**

Create `/frontend/src/constants/config.ts`:

```typescript
import type { CustomCacheConfig, PrefetchPolicy } from '../types'

export const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'

export const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

export const PREFETCH_DEFAULTS: Record<string, PrefetchPolicy> = {
  intel: 'stream',
  amd: 'adaptive',
  apple: 'stream',
  arm: 'next',
  educational: 'none',
  custom: 'none'
}

export const CONFIG_NAMES: Record<string, string> = {
  educational: 'Educational',
  intel: 'Intel 12th Gen',
  amd: 'AMD Zen 4',
  apple: 'Apple M-series',
  arm: 'ARM Cortex',
  custom: 'Custom'
}

export const OPTIMIZATION_LEVELS = ['-O0', '-O1', '-O2', '-O3', '-Os', '-Oz']

export const defaultCustomConfig: CustomCacheConfig = {
  lineSize: 64,
  l1Size: 32768,
  l1Assoc: 8,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

export const STAGE_TEXT: Record<string, string> = {
  idle: 'Run',
  connecting: 'Connecting...',
  preparing: 'Preparing...',
  compiling: 'Compiling...',
  running: 'Running...',
  processing: 'Processing...',
  done: 'Done'
}
```

**Step 7: Create examples constants file**

Create `/frontend/src/constants/examples.ts` (move EXAMPLES object from App.tsx):

```typescript
import type { Example } from '../types'

export const EXAMPLES: Record<string, Example> = {
  matrix_row: {
    name: 'Row-Major Matrix',
    description: 'Sequential memory access - cache friendly',
    language: 'c',
    code: `// ... (copy from App.tsx EXAMPLES.matrix_row)`
  },
  // ... (copy all other examples from App.tsx)
}

export const EXAMPLE_CODE = EXAMPLES.matrix_row.code
```

**Step 8: Commit**

Run:
```bash
git add frontend/src/types frontend/src/utils frontend/src/constants
git commit -m "refactor: create types, utils, and constants for App.tsx restructuring"
```

---

### Task 2: Extract useAnalysisState hook

**Files:**
- Create: `frontend/src/hooks/useAnalysisState.ts`
- Create: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useAnalysisState.ts`:

```typescript
import { useState, useCallback, useMemo } from 'react'
import type { FileTab, Language } from '../types'
import { createFileTab, getFileExtension } from '../utils/file'
import { EXAMPLE_CODE } from '../constants/examples'

export function useAnalysisState() {
  const [files, setFiles] = useState<FileTab[]>(() => [
    createFileTab('main.c', EXAMPLE_CODE, 'c')
  ])
  const [activeFileId, setActiveFileId] = useState<string>(() => files[0]?.id || '')
  const [mainFileId, setMainFileId] = useState<string>(() => files[0]?.id || '')

  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  const code = activeFile?.code || ''
  const language = activeFile?.language || 'c'

  const updateActiveCode = useCallback((newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, code: newCode } : f
    ))
  }, [activeFileId])

  const updateActiveLanguage = useCallback((newLang: Language) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== activeFileId) return f
      const ext = getFileExtension(newLang)
      const baseName = f.name.replace(/\.(c|cpp|rs)$/, '')
      return { ...f, language: newLang, name: baseName + ext }
    }))
  }, [activeFileId])

  const closeFile = useCallback((id: string) => {
    if (files.length <= 1) return
    const idx = files.findIndex(f => f.id === id)
    setFiles(prev => prev.filter(f => f.id !== id))
    if (id === activeFileId) {
      const newIdx = Math.min(idx, files.length - 2)
      const newActive = files.filter(f => f.id !== id)[newIdx]
      if (newActive) setActiveFileId(newActive.id)
    }
  }, [files, activeFileId])

  const renameFile = useCallback((id: string, name: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name } : f
    ))
  }, [])

  const createFile = useCallback((name: string, language: Language) => {
    const newFile = createFileTab(name, '', language)
    setFiles(prev => [...prev, newFile])
    setActiveFileId(newFile.id)
  }, [])

  return {
    files,
    activeFileId,
    mainFileId,
    activeFile,
    code,
    language,
    setActiveFileId,
    setMainFileId,
    updateActiveCode,
    updateActiveLanguage,
    closeFile,
    renameFile,
    createFile
  }
}
```

**Step 2: Create hooks index file**

Create `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
```

**Step 3: Test that the hook exports correctly**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useAnalysisState hook"
```

---

### Task 3: Extract useConfigState hook

**Files:**
- Create: `frontend/src/hooks/useConfigState.ts`
- Modify: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useConfigState.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { Compiler, CustomCacheConfig, PrefetchPolicy, DefineEntry } from '../types'
import { PREFETCH_DEFAULTS, defaultCustomConfig, API_BASE } from '../constants/config'

export function useConfigState() {
  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')
  const [compilers, setCompilers] = useState<Compiler[]>([])
  const [selectedCompiler, setSelectedCompiler] = useState<string>('')
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [sampleRate, setSampleRate] = useState(1)
  const [eventLimit, setEventLimit] = useState(5000000)

  // Fetch compilers on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.compilers && data.compilers.length > 0) {
          setCompilers(data.compilers)
          setSelectedCompiler(data.default || data.compilers[0].id)
        }
      })
      .catch(err => {
        console.warn('Failed to fetch compilers:', err)
      })
  }, [])

  const updateConfig = useCallback((newConfig: string) => {
    setConfig(newConfig)
    setPrefetchPolicy(PREFETCH_DEFAULTS[newConfig] || 'none')
  }, [])

  return {
    config,
    optLevel,
    prefetchPolicy,
    compilers,
    selectedCompiler,
    customConfig,
    defines,
    sampleRate,
    eventLimit,
    setConfig: updateConfig,
    setOptLevel,
    setPrefetchPolicy,
    setSelectedCompiler,
    setCustomConfig,
    setDefines,
    setSampleRate,
    setEventLimit
  }
}
```

**Step 2: Update hooks index**

Edit `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
export { useConfigState } from './useConfigState'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useConfigState hook"
```

---

### Task 4: Extract useTheme hook

**Files:**
- Create: `frontend/src/hooks/useTheme.ts`
- Modify: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useTheme.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { Theme } from '../types'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cache-explorer-theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'dark'
  })

  // Sync theme to DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, setTheme: setThemeState, toggleTheme }
}
```

**Step 2: Update hooks index**

Edit `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
export { useConfigState } from './useConfigState'
export { useTheme } from './useTheme'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useTheme hook"
```

---

### Task 5: Extract useKeyboardShortcuts hook

**Files:**
- Create: `frontend/src/hooks/useKeyboardShortcuts.ts`
- Modify: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useKeyboardShortcuts.ts`:

```typescript
import { useEffect } from 'react'

export interface KeyboardShortcutHandlers {
  onCommandPalette: () => void
  onRun: () => void
  onEscape: () => void
  canRun: boolean
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        handlers.onCommandPalette()
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (handlers.canRun) handlers.onRun()
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        handlers.onEscape()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlers])
}
```

**Step 2: Update hooks index**

Edit `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
export { useConfigState } from './useConfigState'
export { useTheme } from './useTheme'
export { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './useKeyboardShortcuts'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useKeyboardShortcuts hook"
```

---

### Task 6: Extract useUrlState hook

**Files:**
- Create: `frontend/src/hooks/useUrlState.ts`
- Modify: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useUrlState.ts`:

```typescript
import { useEffect, useCallback } from 'react'
import { encodeState, decodeState } from '../utils/state'
import { API_BASE } from '../constants/config'
import type { ShareableState, Language, DefineEntry } from '../types'
import { createFileTab, getFileExtension } from '../utils/file'

export function useUrlState(
  onLoadState: (state: { code: string; config: string; optLevel: string; language?: Language; defines?: DefineEntry[] }) => void,
  deps: [string, string, string, Language, DefineEntry[]]
) {
  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      if (shortId) {
        try {
          const response = await fetch(`${API_BASE}/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            onLoadState(data.state)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          onLoadState(saved)
        }
      }
    }
    loadState()
  }, [onLoadState])

  // Update URL when state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const [code, config, optLevel, language, defines] = deps
      const encoded = encodeState({ code, config, optLevel, language, defines })
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, deps)
}

export async function shareUrl(state: ShareableState): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    })
    const data = await response.json()
    if (data.id) {
      return `${window.location.origin}${window.location.pathname}?s=${data.id}`
    }
  } catch {
    return window.location.href
  }
  return null
}
```

**Step 2: Update hooks index**

Edit `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
export { useConfigState } from './useConfigState'
export { useTheme } from './useTheme'
export { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './useKeyboardShortcuts'
export { useUrlState, shareUrl } from './useUrlState'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useUrlState hook"
```

---

### Task 7: Extract useMobileResponsive hook

**Files:**
- Create: `frontend/src/hooks/useMobileResponsive.ts`
- Modify: `frontend/src/hooks/index.ts`

**Step 1: Create the hook**

Create `/frontend/src/hooks/useMobileResponsive.ts`:

```typescript
import { useState, useEffect } from 'react'

export type MobilePane = 'editor' | 'results'

export function useMobileResponsive() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )
  const [mobilePane, setMobilePane] = useState<MobilePane>('editor')

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return { isMobile, mobilePane, setMobilePane }
}
```

**Step 2: Update hooks index**

Edit `/frontend/src/hooks/index.ts`:

```typescript
export { useAnalysisState } from './useAnalysisState'
export { useConfigState } from './useConfigState'
export { useTheme } from './useTheme'
export { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './useKeyboardShortcuts'
export { useUrlState, shareUrl } from './useUrlState'
export { useMobileResponsive, type MobilePane } from './useMobileResponsive'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/hooks
git commit -m "refactor: extract useMobileResponsive hook"
```

---

### Task 8: Extract AdvancedOptionsModal component

**Files:**
- Create: `frontend/src/components/AdvancedOptionsModal.tsx`
- Modify: `frontend/src/components/index.ts`

**Step 1: Create the component**

Create `/frontend/src/components/AdvancedOptionsModal.tsx`:

```typescript
import type { DefineEntry, CustomCacheConfig } from '../types'

interface AdvancedOptionsModalProps {
  isOpen: boolean
  defines: DefineEntry[]
  customConfig: CustomCacheConfig
  currentConfig: string
  onDefinesChange: (defines: DefineEntry[]) => void
  onCustomConfigChange: (config: CustomCacheConfig) => void
  onClose: () => void
}

export function AdvancedOptionsModal({
  isOpen,
  defines,
  customConfig,
  currentConfig,
  onDefinesChange,
  onCustomConfigChange,
  onClose
}: AdvancedOptionsModalProps) {
  if (!isOpen) return null

  return (
    <div className="options-modal-overlay" onClick={onClose}>
      <div className="options-modal" onClick={e => e.stopPropagation()}>
        <div className="options-modal-header">
          <span>Advanced Options</span>
          <button className="quick-config-close" onClick={onClose}>×</button>
        </div>
        <div className="options-modal-body">
          <div className="option-section">
            <div className="option-label">Preprocessor Defines</div>
            <div className="defines-list">
              {defines.map((def, i) => (
                <div key={i} className="define-row">
                  <span className="define-d">-D</span>
                  <input
                    type="text"
                    placeholder="NAME"
                    value={def.name}
                    onChange={(e) => {
                      const newDefs = [...defines]
                      newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                      onDefinesChange(newDefs)
                    }}
                    className="define-name"
                  />
                  <span className="define-eq">=</span>
                  <input
                    type="text"
                    placeholder="value"
                    value={def.value}
                    onChange={(e) => {
                      const newDefs = [...defines]
                      newDefs[i].value = e.target.value
                      onDefinesChange(newDefs)
                    }}
                    className="define-value"
                  />
                  <button
                    className="btn-remove"
                    onClick={() => onDefinesChange(defines.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="btn-add"
                onClick={() => onDefinesChange([...defines, { name: '', value: '' }])}
              >
                + Add Define
              </button>
            </div>
          </div>

          {currentConfig === 'custom' && (
            <div className="option-section">
              <div className="option-label">Custom Cache Config</div>
              <div className="config-grid">
                <label>Line Size</label>
                <input
                  type="number"
                  value={customConfig.lineSize}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })}
                />
                <label>L1 Size</label>
                <input
                  type="number"
                  value={customConfig.l1Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })}
                />
                <label>L1 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l1Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })}
                />
                <label>L2 Size</label>
                <input
                  type="number"
                  value={customConfig.l2Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })}
                />
                <label>L2 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l2Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })}
                />
                <label>L3 Size</label>
                <input
                  type="number"
                  value={customConfig.l3Size}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })}
                />
                <label>L3 Assoc</label>
                <input
                  type="number"
                  value={customConfig.l3Assoc}
                  onChange={(e) => onCustomConfigChange({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Update components index**

Edit `/frontend/src/components/index.ts`:

```typescript
export { CacheGrid } from './CacheGrid'
export type { CacheLineState, CoreCacheState } from './CacheGrid'

export { MemoryLayout } from './MemoryLayout'
export type { MemoryRegion, MemoryAccess } from './MemoryLayout'

export { FileManager } from './FileManager'
export type { ProjectFile } from './FileManager'

export { AdvancedOptionsModal } from './AdvancedOptionsModal'
```

**Step 3: Test**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

Run:
```bash
git add frontend/src/components/AdvancedOptionsModal.tsx frontend/src/components/index.ts
git commit -m "refactor: extract AdvancedOptionsModal component"
```

---

### Task 9: Create thin App.tsx and migrate to new structure

**Files:**
- Modify: `frontend/src/App.tsx` - Completely rewrite to use new hooks/components

**Step 1: Check current App.tsx to identify all imports and state**

Run: `head -50 frontend/src/App.tsx && tail -50 frontend/src/App.tsx`

Expected: Shows full structure

**Step 2: Write new minimal App.tsx**

This is a large rewrite. Create new `/frontend/src/App.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'
import LZString from 'lz-string'
import './App.css'

// Import hooks
import {
  useAnalysisState,
  useConfigState,
  useTheme,
  useKeyboardShortcuts,
  useUrlState,
  shareUrl,
  useMobileResponsive
} from './hooks'

// Import components
import { MemoryLayout, FileManager, AdvancedOptionsModal } from './components'
import type { ProjectFile } from './components'

// Import types
import type {
  CacheResult,
  ErrorResult,
  Stage,
  TimelineEvent,
  CommandItem as CommandItemType,
  Compiler
} from './types'

// Import utils & constants
import { formatPercent, getRateClass } from './utils/formatting'
import {
  API_BASE,
  WS_URL,
  CONFIG_NAMES,
  STAGE_TEXT,
  OPTIMIZATION_LEVELS,
  PREFETCH_DEFAULTS
} from './constants/config'
import { EXAMPLES } from './constants/examples'

// ===== Inline Components from App.tsx =====
// Note: These should be extracted to separate component files in follow-up
// For now, keeping them inline to minimize scope of this refactoring

function CacheHierarchy({ result }: { result: CacheResult }) {
  // ... (copy implementation from original App.tsx lines 1049-1097)
}

function CacheStats({ result }: { result: CacheResult }) {
  // ... (copy implementation from original App.tsx lines 1099+)
}

// ... (copy other inline components: CacheGrid, InteractiveCacheGrid, FalseSharingViz, etc.)

// ===== Main App Component =====

export default function App() {
  const urlParams = new URLSearchParams(window.location.search)
  const isEmbedMode = urlParams.get('embed') === 'true'
  const isReadOnly = urlParams.get('readonly') === 'true'

  // Use extracted hooks
  const analysisState = useAnalysisState()
  const configState = useConfigState()
  const { theme, toggleTheme } = useTheme()
  const { isMobile, mobilePane, setMobilePane } = useMobileResponsive()

  // Analysis execution state
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)
  const [vimMode, setVimMode] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [showQuickConfig, setShowQuickConfig] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  // Refs
  const commandInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineEvent[]>([])
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const stepDecorationsRef = useRef<string[]>([])
  const optionsRef = useRef<HTMLDivElement>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => {
      setShowCommandPalette(true)
      setCommandQuery('')
      setSelectedCommandIndex(0)
    },
    onRun: () => runAnalysis(),
    onEscape: () => {
      setShowOptions(false)
      setShowCommandPalette(false)
      setShowQuickConfig(false)
    },
    canRun: stage === 'idle'
  })

  // URL state management
  useUrlState(
    (state) => {
      const lang = state.language || 'c'
      analysisState.setActiveFileId((f) => {
        // Create initial file with loaded state
        const newFile = { id: 'main', name: `main.${lang === 'cpp' ? 'cpp' : lang === 'rust' ? 'rs' : 'c'}`, code: state.code, language: lang as any }
        analysisState.setActiveFileId(newFile.id)
        return newFile.id
      })
      configState.setConfig(state.config)
      configState.setOptLevel(state.optLevel)
      if (state.defines) configState.setDefines(state.defines)
    },
    [analysisState.code, configState.config, configState.optLevel, analysisState.language, configState.defines]
  )

  // ... (rest of implementation)
  // Including: click handlers, effects, Monaco editor setup, etc.

  const isLoading = stage !== 'idle' && stage !== 'done'
  const monacoLanguage = analysisState.language === 'cpp' ? 'cpp' : analysisState.language === 'rust' ? 'rust' : 'c'

  const runAnalysis = () => {
    // ... (copy from original App.tsx)
  }

  const handleShare = useCallback(async () => {
    try {
      const url = await shareUrl({
        code: analysisState.code,
        config: configState.config,
        optLevel: configState.optLevel,
        language: analysisState.language,
        defines: configState.defines
      })
      if (url) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [analysisState.code, analysisState.language, configState.config, configState.optLevel, configState.defines])

  // ... (render JSX, copying from original App.tsx)

  return (
    <div className={`app${isEmbedMode ? ' embed' : ''}`}>
      {/* ... JSX content */}
    </div>
  )
}
```

**Step 3: This is a placeholder - the actual migration needs manual review**

The approach is:
1. Keep all inline components temporarily
2. Migrate state piece by piece
3. Use new hooks and extracted components
4. Test after each piece

This will be completed in follow-up tasks. For now, validate the structure compiles.

Run: `cd frontend && npm run build 2>&1 | head -30`

Expected: Should show any remaining issues to address

**Step 4: Commit incremental progress**

Run:
```bash
git add frontend/src/App.tsx
git commit -m "refactor: begin App.tsx restructuring with new hook-based architecture"
```

---

### Task 10: Extract result display components

**Files:**
- Create: `frontend/src/components/ResultsPanel.tsx`
- Create: `frontend/src/components/HotLinesTable.tsx`
- Create: `frontend/src/components/FalseSharingTable.tsx`
- Create: `frontend/src/components/OptimizationSuggestionsPanel.tsx`
- Modify: `frontend/src/components/index.ts`

(This task breaks down the large results rendering logic into focused, reusable components. Each component handles a specific aspect of the analysis results.)

---

## Migration Strategy

### Phase 1: Structure (Tasks 1-4) ✓
- Create types, utils, constants
- Extract basic state hooks
- Validate compilation

### Phase 2: Hooks (Tasks 5-7)
- Extract remaining hooks
- Test each hook independently
- Update App.tsx to use hooks

### Phase 3: Components (Tasks 8-10)
- Extract modal/UI components
- Extract result display panels
- Break down remaining inline components

### Phase 4: Final App.tsx (Task 11 onwards)
- Reduce to <300 lines
- Pure orchestration
- No business logic

---

## Testing Strategy

After each task:
1. `npm run build` - TypeScript validation
2. `npm run dev` - Local testing
3. Manual test in browser - Functionality preserved

After phase completion:
1. Run same features as before
2. Verify compilation pipeline still works
3. Check all keyboard shortcuts
4. Test share functionality
5. Verify theme persistence

---

## Success Criteria

✓ App.tsx reduces from 3,523 to ~300 lines
✓ All state management in typed hooks
✓ Presentational components isolated
✓ No business logic in components
✓ All existing features work identically
✓ Tests pass (if any frontend tests exist)
✓ No console errors or warnings
✓ Mobile and desktop modes work
✓ Build time unchanged
✓ Bundle size unchanged or smaller
