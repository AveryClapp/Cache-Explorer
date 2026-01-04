# App.tsx Final Refactoring: Thin Orchestrator

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Extract remaining inline components and analysis logic, reducing App.tsx from 2,433 to ~900 lines (thin orchestrator with only hook calls and JSX).

**Architecture:** Extract CommandPalette, QuickConfigPanel, and helper components to separate files. Create three new hooks (useEditorState, useAnalysisExecution, useResultState) to encapsulate analysis execution logic. App.tsx becomes pure orchestrator.

**Tech Stack:** React 19, TypeScript, existing hooks, existing components

---

## Implementation Tasks

### Task 1: Extract CommandPalette to component

**Files:**
- Create: `frontend/src/components/CommandPalette.tsx`
- Modify: `frontend/src/components/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create CommandPalette.tsx**

Extract from App.tsx (search for `function CommandPalette`) into new file:

```typescript
import type { CommandItem } from '../types'

interface CommandPaletteProps {
  isOpen: boolean
  query: string
  selectedIndex: number
  onQueryChange: (query: string) => void
  onSelect: (cmd: CommandItem) => void
  onClose: () => void
  onNavigate: (delta: number) => void
  inputRef: React.RefObject<HTMLInputElement>
  commands: CommandItem[]
}

export function CommandPalette({
  isOpen,
  query,
  selectedIndex,
  onQueryChange,
  onSelect,
  onClose,
  onNavigate,
  inputRef,
  commands
}: CommandPaletteProps) {
  // Copy the entire CommandPalette function body from App.tsx (lines 1095-1250)
  // Make sure to:
  // 1. Keep exact logic
  // 2. Use props instead of closure variables
  // 3. Keep all helper functions (fuzzyMatch is used here)
  // 4. Keep all CSS classes
}
```

**Step 2: Update components/index.ts**

Add export:
```typescript
export { CommandPalette } from './CommandPalette'
export type { CommandItem } from '../types'
```

**Step 3: Update App.tsx to use component**

Replace inline `function CommandPalette` definition with import and usage:

```typescript
import { CommandPalette } from './components'

// In render:
<CommandPalette
  isOpen={showCommandPalette}
  query={commandQuery}
  selectedIndex={selectedCommandIndex}
  onQueryChange={setCommandQuery}
  onSelect={handleCommandSelect}
  onClose={() => setShowCommandPalette(false)}
  onNavigate={handleCommandNavigate}
  inputRef={commandInputRef}
  commands={commands}
/>
```

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/components/CommandPalette.tsx frontend/src/components/index.ts frontend/src/App.tsx
git commit -m "refactor: extract CommandPalette to separate component"
```

---

### Task 2: Extract QuickConfigPanel to component

**Files:**
- Create: `frontend/src/components/QuickConfigPanel.tsx`
- Modify: `frontend/src/components/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create QuickConfigPanel.tsx**

Extract from App.tsx (search for `function QuickConfigPanel`) into new file:

```typescript
import type { Compiler, PrefetchPolicy } from '../types'
import { CONFIG_NAMES, OPTIMIZATION_LEVELS } from '../constants/config'

interface QuickConfigPanelProps {
  isOpen: boolean
  config: string
  optLevel: string
  prefetchPolicy: PrefetchPolicy
  compilers: Compiler[]
  selectedCompiler: string
  onConfigChange: (config: string) => void
  onOptLevelChange: (level: string) => void
  onPrefetchChange: (policy: PrefetchPolicy) => void
  onCompilerChange: (id: string) => void
  onClose: () => void
}

export function QuickConfigPanel({
  isOpen,
  config,
  optLevel,
  prefetchPolicy,
  compilers,
  selectedCompiler,
  onConfigChange,
  onOptLevelChange,
  onPrefetchChange,
  onCompilerChange,
  onClose
}: QuickConfigPanelProps) {
  // Copy the entire QuickConfigPanel function body from App.tsx (lines 1251-1347)
}
```

**Step 2: Update components/index.ts**

Add export:
```typescript
export { QuickConfigPanel } from './QuickConfigPanel'
```

**Step 3: Update App.tsx**

Replace inline function with import and usage:

```typescript
import { QuickConfigPanel } from './components'

// In render:
<QuickConfigPanel
  isOpen={showQuickConfig}
  config={configState.config}
  optLevel={configState.optLevel}
  prefetchPolicy={configState.prefetchPolicy}
  compilers={configState.compilers}
  selectedCompiler={configState.selectedCompiler}
  onConfigChange={configState.setConfig}
  onOptLevelChange={configState.setOptLevel}
  onPrefetchChange={configState.setPrefetchPolicy}
  onCompilerChange={configState.setSelectedCompiler}
  onClose={() => setShowQuickConfig(false)}
/>
```

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/components/QuickConfigPanel.tsx frontend/src/components/index.ts frontend/src/App.tsx
git commit -m "refactor: extract QuickConfigPanel to separate component"
```

---

### Task 3: Extract LevelDetail and TLBDetail components

**Files:**
- Create: `frontend/src/components/CacheDetailComponents.tsx`
- Modify: `frontend/src/components/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create CacheDetailComponents.tsx**

Extract both helper components into single file:

```typescript
import type { CacheStats, TLBStats } from '../types'
import { formatPercent } from '../utils/formatting'

interface CacheLevelDetailProps {
  name: string
  stats: CacheStats
}

export function LevelDetail({ name, stats }: CacheLevelDetailProps) {
  // Copy from App.tsx lines ~1348-1368
}

interface TLBDetailProps {
  name: string
  stats: TLBStats
}

export function TLBDetail({ name, stats }: TLBDetailProps) {
  // Copy from App.tsx lines ~1370-1395
}
```

**Step 2: Update components/index.ts**

Add exports:
```typescript
export { LevelDetail, TLBDetail } from './CacheDetailComponents'
```

**Step 3: Update App.tsx**

Replace inline functions with imports. Find usages of `<LevelDetail>` and `<TLBDetail>` in render block - they already use the correct component names, just remove the function definitions.

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/components/CacheDetailComponents.tsx frontend/src/components/index.ts frontend/src/App.tsx
git commit -m "refactor: extract LevelDetail and TLBDetail components"
```

---

### Task 4: Extract useEditorState hook

**Files:**
- Create: `frontend/src/hooks/useEditorState.ts`
- Modify: `frontend/src/hooks/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create useEditorState.ts**

```typescript
import { useRef, useEffect } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'

export function useEditorState() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const stepDecorationsRef = useRef<string[]>([])
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Move these methods from App.tsx:
  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Move useEffect for Vim mode (lines ~2559-2572)
  // Move useEffect for error markers (lines ~2720-2750)
  // Move useEffect for decorations (lines ~2753-2812)
  // Move useEffect for step highlighting (lines ~2815-2846)

  return {
    editorRef,
    monacoRef,
    decorationsRef,
    stepDecorationsRef,
    vimStatusRef,
    vimModeRef,
    handleEditorMount
  }
}
```

**Step 2: Update hooks/index.ts**

Add export:
```typescript
export { useEditorState } from './useEditorState'
```

**Step 3: Update App.tsx**

Replace all editor state and useEffects with:

```typescript
const editorState = useEditorState()
```

Then update all references:
- `editorRef.current` → `editorState.editorRef.current`
- `monacoRef.current` → `editorState.monacoRef.current`
- etc.

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/hooks/useEditorState.ts frontend/src/hooks/index.ts frontend/src/App.tsx
git commit -m "refactor: extract useEditorState hook for editor management"
```

---

### Task 5: Extract useResultState hook

**Files:**
- Create: `frontend/src/hooks/useResultState.ts`
- Modify: `frontend/src/hooks/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create useResultState.ts**

```typescript
import { useState } from 'react'
import type { CacheResult, ErrorResult, Stage, TimelineEvent } from '../types'

export function useResultState() {
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)

  return {
    result,
    setResult,
    stage,
    setStage,
    error,
    setError,
    timeline,
    setTimeline,
    scrubberIndex,
    setScrubberIndex
  }
}
```

**Step 2: Update hooks/index.ts**

Add export:
```typescript
export { useResultState } from './useResultState'
```

**Step 3: Update App.tsx**

Replace these state declarations:
```typescript
const resultState = useResultState()
```

Then update all references:
- `result` → `resultState.result`
- `setResult` → `resultState.setResult`
- etc.

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/hooks/useResultState.ts frontend/src/hooks/index.ts frontend/src/App.tsx
git commit -m "refactor: extract useResultState hook for analysis results"
```

---

### Task 6: Extract useAnalysisExecution hook

**Files:**
- Create: `frontend/src/hooks/useAnalysisExecution.ts`
- Modify: `frontend/src/hooks/index.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create useAnalysisExecution.ts**

This is the complex one - it contains the runAnalysis function and WebSocket logic:

```typescript
import { useCallback, useRef } from 'react'
import { API_BASE, WS_URL } from '../constants/config'
import type { FileTab, Stage, CacheResult, ErrorResult, TimelineEvent } from '../types'

interface UseAnalysisExecutionParams {
  files: FileTab[]
  mainFileId: string
  config: string
  optLevel: string
  prefetchPolicy: string
  customConfig: any
  defines: any[]
  sampleRate: number
  eventLimit: number
  selectedCompiler: string
  onStageChange: (stage: Stage) => void
  onResultChange: (result: CacheResult | null) => void
  onErrorChange: (error: ErrorResult | null) => void
  onTimelineAdd: (events: TimelineEvent[]) => void
  onTimelineReset: () => void
}

export function useAnalysisExecution(params: UseAnalysisExecutionParams) {
  const wsRef = useRef<WebSocket | null>(null)

  const runAnalysis = useCallback(() => {
    // Copy entire runAnalysis function from App.tsx (lines ~2848+)
    // This includes:
    // - Input validation
    // - File compilation
    // - WebSocket connection
    // - Event processing
    // - Error handling
  }, [params.files, params.mainFileId, /* all dependencies */])

  return { runAnalysis }
}
```

**Step 2: Update hooks/index.ts**

Add export:
```typescript
export { useAnalysisExecution } from './useAnalysisExecution'
```

**Step 3: Update App.tsx**

Replace runAnalysis function definition with:

```typescript
const { runAnalysis } = useAnalysisExecution({
  files: analysisState.files,
  mainFileId: analysisState.mainFileId,
  config: configState.config,
  optLevel: configState.optLevel,
  prefetchPolicy: configState.prefetchPolicy,
  customConfig: configState.customConfig,
  defines: configState.defines,
  sampleRate: configState.sampleRate,
  eventLimit: configState.eventLimit,
  selectedCompiler: configState.selectedCompiler,
  onStageChange: setStage,
  onResultChange: setResult,
  onErrorChange: setError,
  onTimelineAdd: (events) => {
    timelineRef.current = [...timelineRef.current, ...events]
    setTimeline(timelineRef.current)
  },
  onTimelineReset: () => {
    timelineRef.current = []
    setTimeline([])
  }
})
```

**Step 4: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/hooks/useAnalysisExecution.ts frontend/src/hooks/index.ts frontend/src/App.tsx
git commit -m "refactor: extract useAnalysisExecution hook for analysis pipeline"
```

---

### Task 7: Move formatPercent and fuzzyMatch to utils

**Files:**
- Modify: `frontend/src/utils/formatting.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Update utils/formatting.ts**

Add fuzzyMatch function:

```typescript
export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qIdx = 0
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) qIdx++
  }
  return qIdx === q.length
}

export function getRateClass(rate: number): string {
  return rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'
}
```

**Step 2: Update App.tsx imports**

Add to imports:
```typescript
import { formatPercent, fuzzyMatch } from './utils/formatting'
```

Remove the inline function definitions from App.tsx (lines ~1051-1094)

**Step 3: Verify TypeScript**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 4: Commit**

```bash
git add frontend/src/utils/formatting.ts frontend/src/App.tsx
git commit -m "refactor: move formatPercent and fuzzyMatch to utils"
```

---

### Task 8: Final App.tsx cleanup and verification

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Remove all inline component and hook function definitions**

Delete these function definitions from App.tsx (now in separate files):
- `function formatPercent(...)`
- `function fuzzyMatch(...)`
- `function CommandPalette(...)`
- `function QuickConfigPanel(...)`
- `function LevelDetail(...)`
- `function TLBDetail(...)`
- `function CacheGrid(...)`

**Step 2: Verify no orphaned code**

Run: `cd frontend && npm run build 2>&1`
Expected: 0 errors, should show App.tsx is significantly smaller

**Step 3: Check final line count**

Run: `wc -l frontend/src/App.tsx`
Expected: Should be ~900-1000 lines

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "refactor: remove inline definitions, App.tsx is now thin orchestrator"
```

---

## Success Criteria

✓ All inline components extracted to separate files
✓ Editor state extracted to useEditorState hook
✓ Analysis execution extracted to useAnalysisExecution hook
✓ Result state extracted to useResultState hook
✓ App.tsx reduced to ~900 lines (pure orchestrator)
✓ TypeScript compilation: 0 errors
✓ All functionality preserved
✓ 8 clean commits for each logical change
