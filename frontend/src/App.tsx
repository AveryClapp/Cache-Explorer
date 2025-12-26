import { useState, useRef, useEffect, useCallback } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import LZString from 'lz-string'
import './App.css'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
  threads?: number
}

interface FalseSharingAccess {
  threadId: number
  offset: number
  isWrite: boolean
  file: string
  line: number
  count: number
}

interface FalseSharingEvent {
  cacheLineAddr: string
  accessCount: number
  accesses: FalseSharingAccess[]
}

interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
}

interface ErrorResult {
  type: 'compile_error' | 'linker_error' | 'runtime_error' | 'timeout' | 'unknown_error' | 'validation_error' | 'server_error'
  errors?: CompileError[]
  summary?: string
  message?: string
  raw?: string
  error?: string
}

interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  levels: {
    l1?: CacheStats
    l1d?: CacheStats
    l1i?: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  coherence?: CoherenceStats
  hotLines: HotLine[]
  falseSharing?: FalseSharingEvent[]
  suggestions?: OptimizationSuggestion[]
}

const EXAMPLES: Record<string, { name: string; code: string; description: string }> = {
  matrix: {
    name: 'Matrix Traversal',
    description: 'Compare row-major vs column-major access',
    code: `#include <stdio.h>

// Use the -D button to override N without editing code
#ifndef N
#define N 100
#endif

int main() {
    int matrix[N][N];

    // Row-major access (cache-friendly)
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            matrix[i][j] = i + j;
        }
    }

    // Column-major access (cache-unfriendly)
    int sum = 0;
    for (int j = 0; j < N; j++) {
        for (int i = 0; i < N; i++) {
            sum += matrix[i][j];
        }
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  sequential: {
    name: 'Sequential Access',
    description: 'Best case - spatial locality',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

int main() {
    int arr[N];
    int sum = 0;

    // Sequential writes - 1 miss per cache line (16 ints)
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Sequential reads - should hit cache
    for (int i = 0; i < N; i++) {
        sum += arr[i];
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  strided: {
    name: 'Strided Access',
    description: 'Worst case - skips cache lines',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

#ifndef STRIDE
#define STRIDE 16  // Skip 16 ints = 64 bytes = 1 cache line
#endif

int main() {
    int arr[N * STRIDE];
    int sum = 0;

    // Initialize
    for (int i = 0; i < N * STRIDE; i++) {
        arr[i] = i;
    }

    // Strided access - misses on every access!
    for (int i = 0; i < N; i++) {
        sum += arr[i * STRIDE];
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  blocking: {
    name: 'Cache Blocking',
    description: 'Optimization technique for matrix multiply',
    code: `#include <stdio.h>

#ifndef N
#define N 64
#endif

#ifndef BLOCK
#define BLOCK 8  // Block size - try different values!
#endif

int A[N][N], B[N][N], C[N][N];

int main() {
    // Initialize matrices
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            A[i][j] = i + j;
            B[i][j] = i - j;
            C[i][j] = 0;
        }
    }

    // Blocked matrix multiply - better cache utilization
    for (int ii = 0; ii < N; ii += BLOCK) {
        for (int jj = 0; jj < N; jj += BLOCK) {
            for (int kk = 0; kk < N; kk += BLOCK) {
                // Multiply block
                for (int i = ii; i < ii + BLOCK && i < N; i++) {
                    for (int j = jj; j < jj + BLOCK && j < N; j++) {
                        int sum = C[i][j];
                        for (int k = kk; k < kk + BLOCK && k < N; k++) {
                            sum += A[i][k] * B[k][j];
                        }
                        C[i][j] = sum;
                    }
                }
            }
        }
    }

    printf("C[0][0] = %d\\n", C[0][0]);
    return 0;
}
`
  },
  linkedlist: {
    name: 'Linked List',
    description: 'Pointer chasing - poor spatial locality',
    code: `#include <stdio.h>
#include <stdlib.h>

#ifndef N
#define N 1000
#endif

struct Node {
    int value;
    struct Node* next;
};

int main() {
    // Allocate nodes (may not be contiguous!)
    struct Node* head = NULL;
    for (int i = 0; i < N; i++) {
        struct Node* node = malloc(sizeof(struct Node));
        node->value = i;
        node->next = head;
        head = node;
    }

    // Traverse - each node may be in different cache line
    int sum = 0;
    struct Node* curr = head;
    while (curr) {
        sum += curr->value;
        curr = curr->next;
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  }
}

const EXAMPLE_CODE = EXAMPLES.matrix.code

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

function LevelStats({ name, stats }: { name: string; stats: CacheStats }) {
  const hitClass = stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'
  return (
    <div className="level-stats">
      <div className="level-name">{name}</div>
      <div className="stat">
        <span className="label">Hits:</span>
        <span className="value">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="stat">
        <span className="label">Misses:</span>
        <span className="value">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="stat">
        <span className="label">Hit Rate:</span>
        <span className={`value ${hitClass}`}>{formatPercent(stats.hitRate)}</span>
      </div>
    </div>
  )
}

function ErrorDisplay({ error }: { error: ErrorResult }) {
  const errorTitles: Record<string, string> = {
    compile_error: 'Compilation Failed',
    linker_error: 'Linker Error',
    runtime_error: 'Runtime Error',
    timeout: 'Execution Timeout',
    unknown_error: 'Error',
    validation_error: 'Invalid Request',
    server_error: 'Server Error'
  }

  return (
    <div className="error">
      <h3>{errorTitles[error.type] || 'Error'}</h3>
      {error.summary && <div className="error-summary">{error.summary}</div>}
      {error.errors && error.errors.length > 0 && (
        <div className="compile-errors">
          {error.errors.map((e, i) => (
            <div key={i} className={`compile-error ${e.severity}`}>
              <span className="location">Line {e.line}:{e.column}</span>
              <span className="severity">{e.severity}</span>
              <span className="message">{e.message}</span>
            </div>
          ))}
        </div>
      )}
      {error.message && <pre className="error-message">{error.message}</pre>}
      {error.raw && <pre className="error-raw">{error.raw}</pre>}
      {error.error && <pre className="error-message">{error.error}</pre>}
    </div>
  )
}

type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

const stageLabels: Record<Stage, string> = {
  idle: 'Run Analysis',
  connecting: 'Connecting...',
  preparing: 'Preparing...',
  compiling: 'Compiling...',
  running: 'Running...',
  processing: 'Processing...',
  done: 'Done'
}

interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

interface DefineEntry {
  name: string
  value: string
}

const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32768,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

// URL State encoding/decoding for shareable links
interface ShareableState {
  code: string
  config: string
  optLevel: string
  defines?: DefineEntry[]
  panes?: PaneState[]
}

interface PaneState {
  id: string
  code: string
  config: string
  result: CacheResult | null
}

function encodeState(state: ShareableState): string {
  const json = JSON.stringify(state)
  return LZString.compressToEncodedURIComponent(json)
}

function decodeState(encoded: string): ShareableState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return JSON.parse(json)
  } catch {
    return null
  }
}

function getStateFromURL(): ShareableState | null {
  const hash = window.location.hash.slice(1)
  if (!hash) return null
  return decodeState(hash)
}

function updateURL(state: ShareableState) {
  const encoded = encodeState(state)
  const newURL = `${window.location.pathname}#${encoded}`
  window.history.replaceState(null, '', newURL)
}

function App() {
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [result, setResult] = useState<CacheResult | null>(null)
  const [compareResult, setCompareResult] = useState<CacheResult | null>(null)
  const [compareConfig, setCompareConfig] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [showCustom, setShowCustom] = useState(false)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [showDefines, setShowDefines] = useState(false)
  const [copied, setCopied] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState(false)
  const [code2, setCode2] = useState(EXAMPLE_CODE)
  const [config2, setConfig2] = useState('intel')
  const [result2, setResult2] = useState<CacheResult | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Load state from URL on mount (supports both hash and short links)
  useEffect(() => {
    const loadState = async () => {
      // Check for short link first
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      if (shortId) {
        try {
          const response = await fetch(`http://localhost:3001/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            setCode(data.state.code)
            setConfig(data.state.config)
            setOptLevel(data.state.optLevel)
            if (data.state.defines) {
              setDefines(data.state.defines)
              if (data.state.defines.length > 0) setShowDefines(true)
            }
            if (data.state.config === 'custom') setShowCustom(true)
            return
          }
        } catch {
          // Fall through to hash-based loading
        }
      }

      // Fall back to hash-based state
      const savedState = getStateFromURL()
      if (savedState) {
        setCode(savedState.code)
        setConfig(savedState.config)
        setOptLevel(savedState.optLevel)
        if (savedState.defines) {
          setDefines(savedState.defines)
          if (savedState.defines.length > 0) setShowDefines(true)
        }
        if (savedState.config === 'custom') setShowCustom(true)
      }
    }

    loadState()
  }, [])

  // Update URL when state changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      updateURL({ code, config, optLevel, defines })
    }, 500)
    return () => clearTimeout(timer)
  }, [code, config, optLevel, defines])

  // Share button handler - creates short link
  const handleShare = useCallback(async () => {
    try {
      const state = { code, config, optLevel, defines }
      const response = await fetch('http://localhost:3001/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      })
      const data = await response.json()
      if (data.id) {
        const shortUrl = `${window.location.origin}${window.location.pathname}?s=${data.id}`
        await navigator.clipboard.writeText(shortUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Fallback to long URL
      const url = window.location.href
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        const input = document.createElement('input')
        input.value = url
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
  }, [code, config, optLevel, defines])

  // Run comparison with a different config
  const runCompare = useCallback(async (cmpConfig: string) => {
    try {
      const payload: Record<string, unknown> = { code, config: cmpConfig, optLevel }
      if (defines.length > 0) {
        payload.defines = defines.filter(d => d.name.trim())
      }
      const response = await fetch('http://localhost:3001/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (data.levels) {
        setCompareResult(data as CacheResult)
      }
    } catch {
      // Ignore comparison errors
    } finally {
      setStage('idle')
    }
  }, [code, optLevel, defines])

  // Apply decorations when results change
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !result) {
      // Clear decorations if no result
      if (editorRef.current && decorationsRef.current.length > 0) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const decorations: editor.IModelDeltaDecoration[] = []

    // Create decorations for hot lines
    for (const line of result.hotLines) {
      // Extract just the filename from the path
      const fileName = line.file.split('/').pop() || line.file

      // Only decorate if this looks like user code (not system headers)
      if (fileName.includes('cache-explorer') || fileName.startsWith('/tmp/')) {
        const lineNum = line.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          // Determine color based on miss rate
          let className = 'line-annotation-good'
          if (line.missRate > 0.5) {
            className = 'line-annotation-bad'
          } else if (line.missRate > 0.2) {
            className = 'line-annotation-warn'
          }

          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className,
              glyphMarginClassName: className.replace('line-', 'glyph-'),
              glyphMarginHoverMessage: {
                value: `**${line.misses} misses** (${(line.missRate * 100).toFixed(1)}% miss rate)`
              }
            }
          })
        }
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)
  }, [result])

  const handleConfigChange = (newConfig: string) => {
    setConfig(newConfig)
    setShowCustom(newConfig === 'custom')
  }

  const runAnalysis = () => {
    setStage('connecting')
    setError(null)
    setResult(null)
    setCompareResult(null)

    const ws = new WebSocket('ws://localhost:3001/ws')

    ws.onopen = () => {
      const payload: Record<string, unknown> = { code, config, optLevel }
      if (config === 'custom') {
        payload.customConfig = customConfig
      }
      if (defines.length > 0) {
        payload.defines = defines.filter(d => d.name.trim())
      }
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'status') {
        setStage(msg.stage as Stage)
      } else if (msg.type === 'result') {
        setResult(msg.data as CacheResult)
        // If compare config is set, run comparison
        if (compareConfig) {
          runCompare(compareConfig)
        } else {
          setStage('idle')
        }
        ws.close()
      } else if (msg.type === 'error') {
        setError(msg as ErrorResult)
        setStage('idle')
        ws.close()
      }
    }

    ws.onerror = () => {
      // Fallback to HTTP if WebSocket fails
      fallbackToHttp()
    }

    ws.onclose = (event) => {
      if (!event.wasClean && stage !== 'idle') {
        fallbackToHttp()
      }
    }

    const fallbackToHttp = async () => {
      setStage('compiling')
      try {
        const payload: Record<string, unknown> = { code, config, optLevel }
        if (config === 'custom') {
          payload.customConfig = customConfig
        }
        if (defines.length > 0) {
          payload.defines = defines.filter(d => d.name.trim())
        }
        const response = await fetch('http://localhost:3001/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await response.json()

        if (data.type || data.error) {
          setError(data as ErrorResult)
        } else if (data.levels) {
          setResult(data as CacheResult)
        } else {
          setError({ type: 'unknown_error', message: 'Unexpected response format' })
        }
      } catch (err) {
        setError({
          type: 'server_error',
          message: err instanceof Error ? err.message : 'Failed to connect to server'
        })
      } finally {
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'

  return (
    <div className="app">
      <header>
        <h1>Cache Explorer</h1>
        <p>Visualize how your code interacts with CPU caches</p>
      </header>

      <div className={`main ${splitMode ? 'split-mode' : ''}`}>
        <div className={`editor-panel ${splitMode ? 'split-pane' : ''}`}>
          <div className="toolbar">
            <select
              onChange={(e) => {
                if (e.target.value && EXAMPLES[e.target.value]) {
                  setCode(EXAMPLES[e.target.value].code)
                  e.target.value = ''  // Reset to show "Examples" again
                }
              }}
              defaultValue=""
              className="examples-select"
            >
              <option value="" disabled>Examples</option>
              {Object.entries(EXAMPLES).map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </select>
            <select value={config} onChange={(e) => handleConfigChange(e.target.value)}>
              <option value="educational">Educational (small caches)</option>
              <option value="intel">Intel 12th Gen</option>
              <option value="amd">AMD Zen 4</option>
              <option value="apple">Apple M-series</option>
              <option value="custom">Custom...</option>
            </select>
            <select
              value={compareConfig || ''}
              onChange={(e) => setCompareConfig(e.target.value || null)}
              className="compare-select"
            >
              <option value="">vs...</option>
              {config !== 'educational' && <option value="educational">vs Educational</option>}
              {config !== 'intel' && <option value="intel">vs Intel 12th Gen</option>}
              {config !== 'amd' && <option value="amd">vs AMD Zen 4</option>}
              {config !== 'apple' && <option value="apple">vs Apple M-series</option>}
            </select>
            <select value={optLevel} onChange={(e) => setOptLevel(e.target.value)}>
              <option value="-O0">-O0 (no optimization)</option>
              <option value="-O1">-O1</option>
              <option value="-O2">-O2</option>
              <option value="-O3">-O3</option>
            </select>
            <button
              className={`toggle-btn ${showDefines ? 'active' : ''}`}
              onClick={() => setShowDefines(!showDefines)}
              title="Preprocessor Defines"
            >
              -D {defines.filter(d => d.name.trim()).length > 0 && `(${defines.filter(d => d.name.trim()).length})`}
            </button>
            <button onClick={runAnalysis} disabled={isLoading}>
              {stageLabels[stage]}
            </button>
            <button onClick={handleShare} className="share-btn">
              {copied ? 'Copied!' : 'Share'}
            </button>
            <button
              onClick={() => setBaselineCode(code)}
              className="baseline-btn"
              title="Save current code as baseline for diff"
            >
              Set Baseline
            </button>
            {baselineCode && (
              <button
                onClick={() => setDiffMode(!diffMode)}
                className={`diff-btn ${diffMode ? 'active' : ''}`}
              >
                {diffMode ? 'Exit Diff' : 'Show Diff'}
              </button>
            )}
            <button
              onClick={() => {
                setSplitMode(!splitMode)
                if (!splitMode) {
                  setCode2(code)  // Copy current code to pane 2
                }
              }}
              className={`split-btn ${splitMode ? 'active' : ''}`}
            >
              {splitMode ? 'Single' : 'Split'}
            </button>
          </div>
          {showCustom && (
            <div className="custom-config">
              <div className="config-row">
                <label>Line Size</label>
                <input
                  type="number"
                  value={customConfig.lineSize}
                  onChange={(e) => setCustomConfig({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })}
                />
              </div>
              <div className="config-section">
                <h4>L1 Cache</h4>
                <div className="config-row">
                  <label>Size (bytes)</label>
                  <input
                    type="number"
                    value={customConfig.l1Size}
                    onChange={(e) => setCustomConfig({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })}
                  />
                </div>
                <div className="config-row">
                  <label>Associativity</label>
                  <input
                    type="number"
                    value={customConfig.l1Assoc}
                    onChange={(e) => setCustomConfig({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })}
                  />
                </div>
              </div>
              <div className="config-section">
                <h4>L2 Cache</h4>
                <div className="config-row">
                  <label>Size (bytes)</label>
                  <input
                    type="number"
                    value={customConfig.l2Size}
                    onChange={(e) => setCustomConfig({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })}
                  />
                </div>
                <div className="config-row">
                  <label>Associativity</label>
                  <input
                    type="number"
                    value={customConfig.l2Assoc}
                    onChange={(e) => setCustomConfig({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })}
                  />
                </div>
              </div>
              <div className="config-section">
                <h4>L3 Cache</h4>
                <div className="config-row">
                  <label>Size (bytes)</label>
                  <input
                    type="number"
                    value={customConfig.l3Size}
                    onChange={(e) => setCustomConfig({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })}
                  />
                </div>
                <div className="config-row">
                  <label>Associativity</label>
                  <input
                    type="number"
                    value={customConfig.l3Assoc}
                    onChange={(e) => setCustomConfig({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })}
                  />
                </div>
              </div>
            </div>
          )}
          {showDefines && (
            <div className="defines-config">
              <div className="defines-header">
                <h4>Preprocessor Defines</h4>
                <button
                  className="add-define-btn"
                  onClick={() => setDefines([...defines, { name: '', value: '' }])}
                >
                  + Add
                </button>
              </div>
              <div className="defines-list">
                {defines.map((def, i) => (
                  <div key={i} className="define-row">
                    <span className="define-prefix">-D</span>
                    <input
                      type="text"
                      placeholder="NAME"
                      value={def.name}
                      onChange={(e) => {
                        const newDefines = [...defines]
                        newDefines[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                        setDefines(newDefines)
                      }}
                      className="define-name"
                    />
                    <span className="define-eq">=</span>
                    <input
                      type="text"
                      placeholder="value"
                      value={def.value}
                      onChange={(e) => {
                        const newDefines = [...defines]
                        newDefines[i].value = e.target.value
                        setDefines(newDefines)
                      }}
                      className="define-value"
                    />
                    <button
                      className="remove-define-btn"
                      onClick={() => setDefines(defines.filter((_, j) => j !== i))}
                    >
                      x
                    </button>
                  </div>
                ))}
                {defines.length === 0 && (
                  <div className="defines-empty">
                    Override #define values without editing code
                  </div>
                )}
              </div>
            </div>
          )}
          {diffMode && baselineCode ? (
            <DiffEditor
              height={`calc(100vh - ${180 + (showCustom ? 200 : 0) + (showDefines ? 120 : 0)}px)`}
              language="c"
              theme="vs-dark"
              original={baselineCode}
              modified={code}
              onMount={(editor) => {
                const modifiedEditor = editor.getModifiedEditor()
                modifiedEditor.onDidChangeModelContent(() => {
                  setCode(modifiedEditor.getValue())
                })
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                renderSideBySide: true,
                readOnly: false,
              }}
            />
          ) : (
            <Editor
              height={`calc(100vh - ${180 + (showCustom ? 200 : 0) + (showDefines ? 120 : 0)}px)`}
              defaultLanguage="c"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                glyphMargin: true,
              }}
            />
          )}
        </div>

        <div className="results-panel">
          {error && <ErrorDisplay error={error} />}

          {result && (
            <>
              <div className="summary">
                <h3>Cache Statistics {compareResult && `- ${result.config}`}</h3>
                <div className="meta">
                  Config: {result.config} | Events: {result.events.toLocaleString()}
                  {result.multicore && (
                    <> | Cores: {result.cores} | Threads: {result.threads}</>
                  )}
                </div>
                <div className="levels">
                  <LevelStats name="L1d" stats={result.levels.l1d || result.levels.l1!} />
                  {result.levels.l1i && <LevelStats name="L1i" stats={result.levels.l1i} />}
                  <LevelStats name="L2" stats={result.levels.l2} />
                  <LevelStats name="L3" stats={result.levels.l3} />
                </div>
              </div>

              {compareResult && (
                <div className="summary compare-summary">
                  <h3>Comparison - {compareResult.config}</h3>
                  <div className="meta">
                    Config: {compareResult.config} | Events: {compareResult.events.toLocaleString()}
                  </div>
                  <div className="levels">
                    <LevelStats name="L1d" stats={compareResult.levels.l1d || compareResult.levels.l1!} />
                    {compareResult.levels.l1i && <LevelStats name="L1i" stats={compareResult.levels.l1i} />}
                    <LevelStats name="L2" stats={compareResult.levels.l2} />
                    <LevelStats name="L3" stats={compareResult.levels.l3} />
                  </div>
                  <div className="compare-diff">
                    <h4>Difference</h4>
                    {(() => {
                      const r1 = result.levels.l1d || result.levels.l1!
                      const r2 = compareResult.levels.l1d || compareResult.levels.l1!
                      const diff = ((r2.hitRate - r1.hitRate) * 100).toFixed(1)
                      const better = r2.hitRate > r1.hitRate
                      return (
                        <div className={`diff-item ${better ? 'better' : 'worse'}`}>
                          L1 Hit Rate: {better ? '+' : ''}{diff}%
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {result.coherence && (
                <div className="coherence-stats">
                  <h3>Cache Coherence</h3>
                  <div className="stat-row">
                    <span className="label">Invalidations:</span>
                    <span className="value">{result.coherence.invalidations.toLocaleString()}</span>
                  </div>
                  <div className="stat-row">
                    <span className="label">False Sharing Events:</span>
                    <span className={`value ${result.coherence.falseSharingEvents > 0 ? 'bad' : 'good'}`}>
                      {result.coherence.falseSharingEvents}
                    </span>
                  </div>
                </div>
              )}

              {result.falseSharing && result.falseSharing.length > 0 && (
                <div className="false-sharing">
                  <h3>⚠ False Sharing Detected</h3>
                  {result.falseSharing.map((fs, i) => (
                    <div key={i} className="false-sharing-item">
                      <div className="cache-line">Cache line {fs.cacheLineAddr}</div>
                      <div className="accesses">
                        {fs.accesses.map((a, j) => (
                          <div key={j} className="access">
                            <span className="thread">T{a.threadId}</span>
                            <span className={`op ${a.isWrite ? 'write' : 'read'}`}>
                              {a.isWrite ? 'WRITE' : 'READ'}
                            </span>
                            <span className="offset">offset {a.offset}</span>
                            <span className="location">{a.file}:{a.line}</span>
                          </div>
                        ))}
                      </div>
                      <div className="suggestion">
                        Consider adding padding between these fields
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.hotLines.length > 0 && (
                <div className="hot-lines">
                  <h3>Hottest Lines (by misses)</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Misses</th>
                        <th>Miss Rate</th>
                        {result.multicore && <th>Threads</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {result.hotLines.map((line, i) => (
                        <tr key={i}>
                          <td className="location">
                            {line.file}:{line.line}
                          </td>
                          <td>{line.misses}</td>
                          <td className={line.missRate > 0.5 ? 'bad' : line.missRate > 0.2 ? 'ok' : 'good'}>
                            {formatPercent(line.missRate)}
                          </td>
                          {result.multicore && <td>{line.threads}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div className="suggestions">
                  <h3>Optimization Suggestions</h3>
                  {result.suggestions.map((s, i) => (
                    <div key={i} className={`suggestion-item ${s.severity}`}>
                      <div className="suggestion-header">
                        <span className={`severity-badge ${s.severity}`}>{s.severity}</span>
                        <span className="suggestion-location">{s.location}</span>
                      </div>
                      <div className="suggestion-message">{s.message}</div>
                      <div className="suggestion-fix">{s.fix}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="loading">
              <div className="spinner"></div>
              <p>{stageLabels[stage]}</p>
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="placeholder">
              <p>Click "Run Analysis" to see cache behavior</p>
            </div>
          )}
        </div>

        {/* Second Pane for Split Mode */}
        {splitMode && (
          <>
            <div className="editor-panel split-pane pane-2">
              <div className="toolbar pane-toolbar">
                <span className="pane-label">Pane 2</span>
                <select value={config2} onChange={(e) => setConfig2(e.target.value)}>
                  <option value="educational">Educational</option>
                  <option value="intel">Intel 12th Gen</option>
                  <option value="amd">AMD Zen 4</option>
                  <option value="apple">Apple M-series</option>
                </select>
                <button
                  onClick={async () => {
                    try {
                      const payload = { code: code2, config: config2, optLevel }
                      const response = await fetch('http://localhost:3001/compile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      })
                      const data = await response.json()
                      if (data.levels) {
                        setResult2(data as CacheResult)
                      }
                    } catch {
                      // Ignore errors
                    }
                  }}
                >
                  Run
                </button>
              </div>
              <Editor
                height="calc(100vh - 220px)"
                defaultLanguage="c"
                theme="vs-dark"
                value={code2}
                onChange={(value) => setCode2(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
            <div className="results-panel split-results">
              {result2 ? (
                <div className="summary">
                  <h3>Pane 2 - {result2.config}</h3>
                  <div className="levels">
                    <LevelStats name="L1d" stats={result2.levels.l1d || result2.levels.l1!} />
                    {result2.levels.l1i && <LevelStats name="L1i" stats={result2.levels.l1i} />}
                    <LevelStats name="L2" stats={result2.levels.l2} />
                    <LevelStats name="L3" stats={result2.levels.l3} />
                  </div>
                </div>
              ) : (
                <div className="placeholder">
                  <p>Run Pane 2 to see results</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
