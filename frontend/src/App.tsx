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

type Language = 'c' | 'cpp' | 'rust'

interface Example {
  name: string
  code: string
  description: string
  language: Language
}

const EXAMPLES: Record<string, Example> = {
  matrix: {
    name: 'Matrix Traversal',
    description: 'Row-major vs column-major',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 100
#endif

int main() {
    int matrix[N][N];

    // Row-major (cache-friendly)
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            matrix[i][j] = i + j;

    // Column-major (cache-unfriendly)
    int sum = 0;
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += matrix[i][j];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  sequential: {
    name: 'Sequential Access',
    description: 'Best case - spatial locality',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

int main() {
    int arr[N];
    int sum = 0;

    for (int i = 0; i < N; i++) arr[i] = i;
    for (int i = 0; i < N; i++) sum += arr[i];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  strided: {
    name: 'Strided Access',
    description: 'Worst case - skips cache lines',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

#ifndef STRIDE
#define STRIDE 16  // 64 bytes = 1 cache line
#endif

int main() {
    int arr[N * STRIDE];
    for (int i = 0; i < N * STRIDE; i++) arr[i] = i;

    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i * STRIDE];  // Miss every time!

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  blocking: {
    name: 'Cache Blocking',
    description: 'Matrix multiply optimization',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 64
#endif

#ifndef BLOCK
#define BLOCK 8
#endif

int A[N][N], B[N][N], C[N][N];

int main() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            A[i][j] = i + j;
            B[i][j] = i - j;
            C[i][j] = 0;
        }

    // Blocked multiply - better cache reuse
    for (int ii = 0; ii < N; ii += BLOCK)
        for (int jj = 0; jj < N; jj += BLOCK)
            for (int kk = 0; kk < N; kk += BLOCK)
                for (int i = ii; i < ii + BLOCK && i < N; i++)
                    for (int j = jj; j < jj + BLOCK && j < N; j++) {
                        int sum = C[i][j];
                        for (int k = kk; k < kk + BLOCK && k < N; k++)
                            sum += A[i][k] * B[k][j];
                        C[i][j] = sum;
                    }

    printf("C[0][0] = %d\\n", C[0][0]);
    return 0;
}
`
  },
  linkedlist: {
    name: 'Linked List',
    description: 'Pointer chasing - poor locality',
    language: 'c',
    code: `#include <stdio.h>
#include <stdlib.h>

#ifndef N
#define N 1000
#endif

struct Node { int value; struct Node* next; };

int main() {
    struct Node* head = NULL;
    for (int i = 0; i < N; i++) {
        struct Node* n = malloc(sizeof(struct Node));
        n->value = i;
        n->next = head;
        head = n;
    }

    int sum = 0;
    for (struct Node* c = head; c; c = c->next)
        sum += c->value;

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  // C++ Examples (using C-compatible constructs for ARM64 compatibility)
  cpp_struct: {
    name: 'C++ Structs',
    description: 'Struct layout and cache behavior',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

struct Point {
    float x, y, z;  // 12 bytes
};

Point points[N];
float result;

int main() {
    // Initialize - sequential access
    for (int i = 0; i < N; i++) {
        points[i].x = (float)i;
        points[i].y = (float)i * 2;
        points[i].z = (float)i * 3;
    }

    // Access pattern matters for cache
    float total = 0;
    for (int i = 0; i < N; i++) {
        Point& p = points[i];
        total += p.x * p.x + p.y * p.y + p.z * p.z;
    }

    result = total;
    return 0;
}
`
  },
  aos_vs_soa: {
    name: 'AoS vs SoA',
    description: 'Array of Structs vs Struct of Arrays',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

// Array of Structs - poor cache use for single field
struct ParticleAoS {
    float x, y, z;
    float vx, vy, vz;
    float mass;
    int id;  // 32 bytes total
};

// Struct of Arrays - better for field-wise access
float soa_x[N], soa_y[N], soa_z[N];
float soa_mass[N];

ParticleAoS aos[N];
float result_aos, result_soa;

int main() {
    // Initialize both layouts
    for (int i = 0; i < N; i++) {
        aos[i].x = aos[i].y = aos[i].z = (float)i;
        aos[i].mass = 1.0f;
        soa_x[i] = soa_y[i] = soa_z[i] = (float)i;
        soa_mass[i] = 1.0f;
    }

    // AoS: loads 32 bytes per element, uses only 4
    float sum_aos = 0;
    for (int i = 0; i < N; i++)
        sum_aos += aos[i].x;

    // SoA: contiguous x values, perfect cache use
    float sum_soa = 0;
    for (int i = 0; i < N; i++)
        sum_soa += soa_x[i];

    result_aos = sum_aos;
    result_soa = sum_soa;
    return 0;
}
`
  },
  cpp_template: {
    name: 'Template Array',
    description: 'Simple template with cache behavior',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

template<typename T, int Size>
struct Array {
    T data[Size];
    T& operator[](int i) { return data[i]; }
};

Array<int, N> arr;
int result;

int main() {
    // Write sequentially
    for (int i = 0; i < N; i++)
        arr[i] = i;

    // Read sequentially - cache friendly
    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i];

    result = sum;
    return 0;
}
`
  },
}

const EXAMPLE_CODE = EXAMPLES.matrix.code

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

function CacheBar({ result }: { result: CacheResult }) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l1i = result.levels.l1i
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.9 ? 'good' : rate > 0.7 ? 'ok' : 'bad'

  return (
    <div className="cache-bar">
      <div className={`cache-item ${getClass(l1d.hitRate)}`}>
        <span className="cache-label">L1d</span>
        <span className="cache-rate">{formatPercent(l1d.hitRate)}</span>
      </div>
      {l1i && (
        <div className={`cache-item ${getClass(l1i.hitRate)}`}>
          <span className="cache-label">L1i</span>
          <span className="cache-rate">{formatPercent(l1i.hitRate)}</span>
        </div>
      )}
      <div className={`cache-item ${getClass(l2.hitRate)}`}>
        <span className="cache-label">L2</span>
        <span className="cache-rate">{formatPercent(l2.hitRate)}</span>
      </div>
      <div className={`cache-item ${getClass(l3.hitRate)}`}>
        <span className="cache-label">L3</span>
        <span className="cache-rate">{formatPercent(l3.hitRate)}</span>
      </div>
      <div className="cache-item events">
        <span className="cache-label">Events</span>
        <span className="cache-rate">{result.events.toLocaleString()}</span>
      </div>
    </div>
  )
}

function LevelDetail({ name, stats }: { name: string; stats: CacheStats }) {
  return (
    <div className="level-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
    </div>
  )
}

function ErrorDisplay({ error }: { error: ErrorResult }) {
  const titles: Record<string, string> = {
    compile_error: 'Compilation Failed',
    linker_error: 'Linker Error',
    runtime_error: 'Runtime Error',
    timeout: 'Timeout',
    unknown_error: 'Error',
    validation_error: 'Invalid Request',
    server_error: 'Server Error'
  }

  return (
    <div className="error-box">
      <div className="error-title">{titles[error.type] || 'Error'}</div>
      {error.summary && <div className="error-summary">{error.summary}</div>}
      {error.errors?.map((e, i) => (
        <div key={i} className={`error-item ${e.severity}`}>
          <span className="error-loc">Line {e.line}:{e.column}</span>
          <span className="error-msg">{e.message}</span>
        </div>
      ))}
      {error.message && <pre className="error-pre">{error.message}</pre>}
      {error.raw && <pre className="error-pre">{error.raw}</pre>}
      {error.error && <pre className="error-pre">{error.error}</pre>}
    </div>
  )
}

type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

interface DefineEntry {
  name: string
  value: string
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

const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32768,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

function encodeState(state: ShareableState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(state))
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

function App() {
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [language, setLanguage] = useState<Language>('c')
  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [copied, setCopied] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const optionsRef = useRef<HTMLDivElement>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  // Close options dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (stage === 'idle') runAnalysis()
      }
      // Escape to close dropdown
      if (e.key === 'Escape') {
        setShowOptions(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
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
            if (data.state.language) setLanguage(data.state.language)
            if (data.state.defines) setDefines(data.state.defines)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          setCode(saved.code)
          setConfig(saved.config)
          setOptLevel(saved.optLevel)
          if (saved.language) setLanguage(saved.language)
          if (saved.defines) setDefines(saved.defines)
        }
      }
    }
    loadState()
  }, [])

  // Update URL when state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const encoded = encodeState({ code, config, optLevel, language, defines })
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, [code, config, optLevel, language, defines])

  const handleShare = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3001/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { code, config, optLevel, language, defines } }),
      })
      const data = await response.json()
      if (data.id) {
        const url = `${window.location.origin}${window.location.pathname}?s=${data.id}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code, config, optLevel, language, defines])

  // Apply decorations
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !result) {
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

    for (const line of result.hotLines) {
      const fileName = line.file.split('/').pop() || line.file
      if (fileName.includes('cache-explorer') || fileName.startsWith('/tmp/')) {
        const lineNum = line.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          let className = 'line-good'
          if (line.missRate > 0.5) className = 'line-bad'
          else if (line.missRate > 0.2) className = 'line-warn'

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

  const runAnalysis = () => {
    setStage('connecting')
    setError(null)
    setResult(null)

    const ws = new WebSocket('ws://localhost:3001/ws')

    ws.onopen = () => {
      const payload: Record<string, unknown> = { code, config, optLevel, language }
      if (config === 'custom') payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'result') {
        setResult(msg.data as CacheResult)
        setStage('idle')
        ws.close()
      } else if (msg.type === 'error') {
        setError(msg as ErrorResult)
        setStage('idle')
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stage !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      setStage('compiling')
      try {
        const payload: Record<string, unknown> = { code, config, optLevel, language }
        if (config === 'custom') payload.customConfig = customConfig
        if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())

        const response = await fetch('http://localhost:3001/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'
  const stageText = { idle: '', connecting: 'Connecting...', preparing: 'Preparing...', compiling: 'Compiling...', running: 'Running...', processing: 'Processing...', done: '' }

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-left">
          <select
            className="select-example"
            onChange={(e) => {
              const ex = EXAMPLES[e.target.value]
              if (ex) {
                setCode(ex.code)
                setLanguage(ex.language)
                e.target.value = ''
              }
            }}
            defaultValue=""
          >
            <option value="" disabled>Examples</option>
            <optgroup label="C">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'c').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
            <optgroup label="C++">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'cpp').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
            <optgroup label="Rust">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'rust').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
          </select>

          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="select-lang">
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="rust">Rust</option>
          </select>

          <select value={config} onChange={(e) => setConfig(e.target.value)} className="select-config">
            <option value="educational">Educational</option>
            <option value="intel">Intel 12th Gen</option>
            <option value="amd">AMD Zen 4</option>
            <option value="apple">Apple M-series</option>
            <option value="custom">Custom</option>
          </select>

          <select value={optLevel} onChange={(e) => setOptLevel(e.target.value)} className="select-opt">
            <option value="-O0">-O0</option>
            <option value="-O1">-O1</option>
            <option value="-O2">-O2</option>
            <option value="-O3">-O3</option>
          </select>
        </div>

        <div className="toolbar-center">
          <button onClick={runAnalysis} disabled={isLoading} className="btn-run">
            {isLoading ? stageText[stage] : 'Run'}
          </button>
        </div>

        <div className="toolbar-right">
          <button onClick={handleShare} className="btn-icon" title="Copy link">
            {copied ? 'Copied!' : 'Share'}
          </button>

          <div className="options-wrapper" ref={optionsRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowOptions(!showOptions) }}
              className={`btn-icon ${showOptions ? 'active' : ''}`}
            >
              Options
            </button>

            {showOptions && (
              <div className="options-dropdown">
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
                            setDefines(newDefs)
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
                            setDefines(newDefs)
                          }}
                          className="define-value"
                        />
                        <button className="btn-remove" onClick={() => setDefines(defines.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    <button className="btn-add" onClick={() => setDefines([...defines, { name: '', value: '' }])}>
                      + Add Define
                    </button>
                  </div>
                </div>

                <div className="option-divider" />

                <div className="option-section">
                  <div className="option-label">Diff Mode</div>
                  <button
                    className={`btn-option ${baselineCode ? '' : 'disabled'}`}
                    onClick={() => { if (baselineCode) setDiffMode(!diffMode) }}
                  >
                    {diffMode ? 'Exit Diff' : 'Show Diff'}
                  </button>
                  <button className="btn-option" onClick={() => setBaselineCode(code)}>
                    Set Current as Baseline
                  </button>
                </div>

                {config === 'custom' && (
                  <>
                    <div className="option-divider" />
                    <div className="option-section">
                      <div className="option-label">Custom Cache Config</div>
                      <div className="config-grid">
                        <label>Line Size</label>
                        <input type="number" value={customConfig.lineSize} onChange={(e) => setCustomConfig({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })} />
                        <label>L1 Size</label>
                        <input type="number" value={customConfig.l1Size} onChange={(e) => setCustomConfig({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })} />
                        <label>L1 Assoc</label>
                        <input type="number" value={customConfig.l1Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })} />
                        <label>L2 Size</label>
                        <input type="number" value={customConfig.l2Size} onChange={(e) => setCustomConfig({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })} />
                        <label>L2 Assoc</label>
                        <input type="number" value={customConfig.l2Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })} />
                        <label>L3 Size</label>
                        <input type="number" value={customConfig.l3Size} onChange={(e) => setCustomConfig({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })} />
                        <label>L3 Assoc</label>
                        <input type="number" value={customConfig.l3Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="main">
        <div className="editor-pane">
          {diffMode && baselineCode ? (
            <DiffEditor
              height="100%"
              language={monacoLanguage}
              theme="vs-dark"
              original={baselineCode}
              modified={code}
              onMount={(editor) => {
                const modifiedEditor = editor.getModifiedEditor()
                modifiedEditor.onDidChangeModelContent(() => setCode(modifiedEditor.getValue()))
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, renderSideBySide: true }}
            />
          ) : (
            <Editor
              height="100%"
              language={monacoLanguage}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorMount}
              options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true }}
            />
          )}
        </div>

        <div className="results-pane">
          {error && <ErrorDisplay error={error} />}

          {result && (
            <>
              <CacheBar result={result} />

              <button className="btn-details" onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? 'Hide Details' : 'Show Details'}
              </button>

              {showDetails && (
                <div className="details-grid">
                  <LevelDetail name="L1 Data" stats={result.levels.l1d || result.levels.l1!} />
                  {result.levels.l1i && <LevelDetail name="L1 Instruction" stats={result.levels.l1i} />}
                  <LevelDetail name="L2" stats={result.levels.l2} />
                  <LevelDetail name="L3" stats={result.levels.l3} />
                </div>
              )}

              {result.coherence && result.coherence.falseSharingEvents > 0 && (
                <div className="warning-box">
                  <div className="warning-title">False Sharing Detected</div>
                  <div className="warning-count">{result.coherence.falseSharingEvents} event(s)</div>
                </div>
              )}

              {result.hotLines.length > 0 && (
                <div className="hotlines">
                  <div className="section-title">Hot Lines</div>
                  <table>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Misses</th>
                        <th>Miss Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.hotLines.slice(0, 10).map((line, i) => (
                        <tr key={i}>
                          <td className="mono">{line.line}</td>
                          <td className="mono">{line.misses}</td>
                          <td className={`mono ${line.missRate > 0.5 ? 'bad' : line.missRate > 0.2 ? 'ok' : 'good'}`}>
                            {formatPercent(line.missRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div className="suggestions">
                  <div className="section-title">Suggestions</div>
                  {result.suggestions.map((s, i) => (
                    <div key={i} className={`suggestion ${s.severity}`}>
                      <span className={`badge ${s.severity}`}>{s.severity}</span>
                      <span className="suggestion-msg">{s.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="loading">
              <div className="spinner" />
              <span>{stageText[stage]}</span>
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="placeholder">
              Press Run to analyze cache behavior
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
